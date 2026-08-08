import { realpathSync, statSync } from 'node:fs';

import * as vscode from 'vscode';

import type { RenderRequest } from '../models/renderRequest';
import type { RenderResult } from '../models/renderResult';
import { sanitizeRenderedHtml } from '../renderer/documentRenderer';
import { getPreviewSettings } from '../settings/extensionSettings';
import { RevisionDebouncer } from '../utility/asyncDebouncer';
import { getErrorMessage } from '../utility/errorMessage';
import {
  createHostFileSystemUri,
  isHostFileSystemUri,
} from './hostFileSystemUri';
import { createPreviewTitle, resolveDocumentKind } from './previewDocument';
import { createPreviewHtml } from './previewHtmlFactory';
import type { PreviewLayout } from './previewLayout';
import {
  isWebviewToExtensionMessage,
  type ExtensionToWebviewMessage,
  type PreviewScrollMessage,
  type PreviewToolbarAction,
} from './previewMessage';
import {
  isPathWithinRoot,
  resolvePreviewImage,
  resolvePreviewStylesheet,
} from './previewResource';
import { formatRenderMessageForLog } from './renderMessageLog';
import { WebviewDeliveryState } from './webviewDeliveryState';

export type PreviewRenderer = (
  request: RenderRequest,
  signal: AbortSignal,
) => Promise<RenderResult>;

export interface PreviewSessionOptions {
  readonly allowedResourceRootPaths: readonly string[];
  readonly documentUri: vscode.Uri;
  readonly extensionUri: vscode.Uri;
  readonly onActivate: (session: PreviewSession) => void;
  readonly onDispose: (session: PreviewSession) => void;
  readonly onToolbarAction: (action: PreviewToolbarAction) => Promise<void>;
  readonly openLink: (
    documentUri: vscode.Uri,
    href: string,
  ) => Promise<void>;
  readonly outputChannel: vscode.OutputChannel;
  readonly panel: vscode.WebviewPanel;
  readonly renderer: PreviewRenderer;
}

/**
 * 管理單一來源文件與 Webview 的生命週期。
 *
 * 全域 VS Code 事件由 PreviewManager 集中註冊，再轉送到對應 session，
 * 避免每開一個預覽就重複掛載 workspace listener。
 */
export class PreviewSession implements vscode.Disposable {
  private allowedResourceRootPaths: readonly string[];
  private activeRenderController: AbortController | undefined;
  private disposed = false;
  private lastEditorSourceLine: number | undefined;
  private nextSequence = Date.now();
  private pendingWebviewSequence: number | undefined;
  private readonly renderDebouncer = new RevisionDebouncer();
  private readonly sessionDisposables: vscode.Disposable[] = [];
  private readonly webviewState = new WebviewDeliveryState();

  public readonly documentUri: vscode.Uri;
  public readonly panel: vscode.WebviewPanel;

  public constructor(private readonly options: PreviewSessionOptions) {
    this.allowedResourceRootPaths = options.allowedResourceRootPaths;
    this.documentUri = options.documentUri;
    this.panel = options.panel;

    this.sessionDisposables.push(
      this.panel.webview.onDidReceiveMessage((message: unknown) => {
        void this.handleWebviewMessage(message).catch((error: unknown) => {
          this.options.outputChannel.appendLine(
            `[${new Date().toISOString()}] Preview action failed for `
            + `${this.getDocumentLogLabel()}: ${getErrorMessage(error)}`,
          );
        });
      }),
      this.panel.onDidChangeViewState(({ webviewPanel }) => {
        if (webviewPanel.active) {
          this.options.onActivate(this);
        }
      }),
      this.panel.onDidDispose(() => {
        this.disposeSession(false);
      }),
    );

    this.reloadWebview();
  }

  public get isActive(): boolean {
    return this.panel.active;
  }

  public refresh(): void {
    this.scheduleRender(0);
  }

  public revealLayout(layout: PreviewLayout): void {
    if (this.disposed || layout === 'source') {
      return;
    }

    this.panel.reveal(
      layout === 'split'
        ? vscode.ViewColumn.Beside
        : vscode.ViewColumn.Active,
      layout === 'split',
    );
  }

  public handleDocumentChange(): void {
    const { updateDelay } = getPreviewSettings(this.documentUri);
    this.scheduleRender(updateDelay);
  }

  public handleConfigurationChange(
    event: vscode.ConfigurationChangeEvent,
  ): void {
    if (
      event.affectsConfiguration(
        'adocmdForge.preview.allowRemoteImages',
        this.documentUri,
      )
    ) {
      this.reloadWebview();
    }
  }

  public updateResourceRoots(
    allowedResourceRootPaths: readonly string[],
    localResourceRoots: readonly vscode.Uri[],
  ): void {
    this.allowedResourceRootPaths = allowedResourceRootPaths;
    this.panel.webview.options = {
      ...this.panel.webview.options,
      localResourceRoots,
    };
    this.reloadWebview();
    this.refresh();
  }

  public handleEditorScroll(editor: vscode.TextEditor): void {
    if (
      this.disposed
      || !this.webviewState.isReady
      || !this.panel.visible
      || !getPreviewSettings(this.documentUri).scrollSync
      || editor.document.uri.toString() !== this.documentUri.toString()
    ) {
      return;
    }

    const sourceLine = editor.visibleRanges[0]?.start.line;
    if (sourceLine === undefined) {
      return;
    }

    const pendingSequence = this.pendingWebviewSequence;
    if (
      pendingSequence === undefined
      && sourceLine === this.lastEditorSourceLine
    ) {
      return;
    }

    this.pendingWebviewSequence = undefined;
    this.lastEditorSourceLine = sourceLine;
    this.postMessage({
      type: 'scrollToSourceLine',
      line: sourceLine,
      sequence: pendingSequence ?? this.createSequence(),
    });
  }

  public dispose(): void {
    this.disposeSession(true);
  }

  private scheduleRender(delay: number): void {
    if (this.disposed) {
      return;
    }

    this.cancelActiveRender();
    if (!this.webviewState.isReady) {
      this.renderDebouncer.invalidate();
      return;
    }

    this.renderDebouncer.schedule(delay, (requestedRevision): void => {
      void this.render(requestedRevision);
    });
  }

  private async render(requestedRevision: number): Promise<void> {
    let renderController: AbortController | undefined;

    try {
      const document = await vscode.workspace.openTextDocument(this.documentUri);
      if (this.isStale(requestedRevision)) {
        return;
      }

      const kind = resolveDocumentKind(document.languageId, document.fileName);
      if (kind === undefined) {
        throw new Error(
          'Only .adoc, .asciidoc, and .md documents can be previewed.',
        );
      }

      const request: RenderRequest = isHostFileSystemUri(document.uri)
        ? {
            allowLocalIncludes: vscode.workspace.isTrusted,
            allowedIncludeRootPaths: this.allowedResourceRootPaths,
            kind,
            source: document.getText(),
            sourcePath: document.uri.fsPath,
          }
        : {
            kind,
            source: document.getText(),
          };
      renderController = new AbortController();
      this.activeRenderController = renderController;
      const result = await this.options.renderer(
        request,
        renderController.signal,
      );
      if (this.isStale(requestedRevision)) {
        return;
      }

      this.writeRenderMessages(result);
      this.panel.title = createPreviewTitle(document.fileName);
      const html = this.rewriteImageSources(
        result.html,
        request.sourcePath,
      );
      const stylesheets = this.resolveStylesheetSources(
        result.stylesheets,
        request.sourcePath,
      );
      this.postMessage({
        type: 'render',
        revision: requestedRevision,
        html,
        lineCount: result.lineCount,
        ...(stylesheets.length > 0 ? { stylesheets } : {}),
      });
      this.syncCurrentEditor();
    } catch (error) {
      if (
        this.isStale(requestedRevision)
        || renderController?.signal.aborted === true
      ) {
        return;
      }

      const message = getErrorMessage(error);
      this.options.outputChannel.appendLine(
        `[${new Date().toISOString()}] Preview render failed for `
        + `${this.getDocumentLogLabel()}: ${message}`,
      );
      this.postMessage({
        type: 'showError',
        revision: requestedRevision,
        message: `Unable to render this document: ${message}`,
      });
    } finally {
      if (this.activeRenderController === renderController) {
        this.activeRenderController = undefined;
      }
    }
  }

  private writeRenderMessages(result: RenderResult): void {
    for (const message of result.messages ?? []) {
      this.options.outputChannel.appendLine(
        `[${new Date().toISOString()}] Preview `
        + `${formatRenderMessageForLog(message)} for `
        + this.getDocumentLogLabel(),
      );
    }
  }

  private rewriteImageSources(
    html: string,
    sourceFilePath: string | undefined,
  ): string {
    const allowRemoteImages = this.canLoadRemoteImages();
    const physicalRootPaths = this.getPhysicalRootPaths();
    const webviewResourceScheme = this.panel.webview.asWebviewUri(
      this.options.extensionUri,
    ).scheme;

    return sanitizeRenderedHtml(html, {
      additionalImageSchemes: [
        webviewResourceScheme,
      ],
      transformTags: {
        img: (tagName, attributes) => {
          const imageSource = attributes.src;
          if (imageSource === undefined) {
            return {
              tagName,
              attribs: attributes,
            };
          }

          const resolution = resolvePreviewImage(
            sourceFilePath,
            this.allowedResourceRootPaths,
            imageSource,
          );
          if (resolution.kind === 'external') {
            if (allowRemoteImages) {
              return {
                tagName,
                attribs: attributes,
              };
            }
          }
          if (resolution.kind === 'local') {
            const physicalImagePath = this.resolvePhysicalImagePath(
              resolution.path,
              physicalRootPaths,
            );
            if (physicalImagePath === undefined) {
              const safeAttributes = {
                ...attributes,
              };
              delete safeAttributes.src;
              return {
                tagName,
                attribs: safeAttributes,
              };
            }

            return {
              tagName,
              attribs: {
                ...attributes,
                src: this.panel.webview.asWebviewUri(
                  createHostFileSystemUri(
                    this.documentUri,
                    physicalImagePath,
                  ),
                ).toString(),
              },
            };
          }

          const safeAttributes = {
            ...attributes,
          };
          delete safeAttributes.src;
          return {
            tagName,
            attribs: safeAttributes,
          };
        },
      },
    });
  }

  private resolvePhysicalImagePath(
    requestedPath: string,
    physicalRootPaths: readonly string[],
  ): string | undefined {
    try {
      const physicalImagePath = realpathSync(requestedPath);
      if (
        !statSync(physicalImagePath).isFile()
        || !physicalRootPaths.some(
          (rootPath) => isPathWithinRoot(physicalImagePath, rootPath),
        )
      ) {
        return undefined;
      }

      return physicalImagePath;
    } catch {
      return undefined;
    }
  }

  private resolveStylesheetSources(
    stylesheetPaths: readonly string[] | undefined,
    sourceFilePath: string | undefined,
  ): readonly string[] {
    if (
      stylesheetPaths === undefined
      || stylesheetPaths.length === 0
      || sourceFilePath === undefined
      || !vscode.workspace.isTrusted
    ) {
      return [];
    }

    const physicalRootPaths = this.getPhysicalRootPaths();
    const sources: string[] = [];
    const seen = new Set<string>();
    for (const stylesheetPath of stylesheetPaths) {
      const requestedPath = resolvePreviewStylesheet(
        this.allowedResourceRootPaths,
        stylesheetPath,
      );
      if (requestedPath === undefined) {
        continue;
      }

      const physicalStylesheetPath = this.resolvePhysicalStylesheetPath(
        requestedPath,
        physicalRootPaths,
      );
      if (physicalStylesheetPath === undefined) {
        continue;
      }

      const source = this.panel.webview.asWebviewUri(
        createHostFileSystemUri(
          this.documentUri,
          physicalStylesheetPath,
        ),
      ).toString();
      if (!seen.has(source)) {
        seen.add(source);
        sources.push(source);
      }
    }

    return sources;
  }

  private resolvePhysicalStylesheetPath(
    requestedPath: string,
    physicalRootPaths: readonly string[],
  ): string | undefined {
    try {
      const physicalStylesheetPath = realpathSync(requestedPath);
      if (
        !statSync(physicalStylesheetPath).isFile()
        || !physicalRootPaths.some(
          (rootPath) => isPathWithinRoot(physicalStylesheetPath, rootPath),
        )
      ) {
        return undefined;
      }

      return physicalStylesheetPath;
    } catch {
      return undefined;
    }
  }

  private getPhysicalRootPaths(): readonly string[] {
    return this.allowedResourceRootPaths.flatMap((rootPath) => {
      try {
        return [realpathSync(rootPath)];
      } catch {
        return [];
      }
    });
  }

  private async handleWebviewMessage(message: unknown): Promise<void> {
    if (this.disposed || !isWebviewToExtensionMessage(message)) {
      return;
    }

    switch (message.type) {
      case 'ready':
        this.webviewState.markReady();
        this.refresh();
        break;

      case 'rendered':
        break;

      case 'scroll':
        this.revealSourceLine(message);
        break;

      case 'openLink':
        await this.options.openLink(this.documentUri, message.href);
        break;

      case 'toolbarAction':
        await this.options.onToolbarAction(message.action);
        break;
    }
  }

  private reloadWebview(): void {
    if (this.disposed) {
      return;
    }

    this.webviewState.markReloading();
    this.panel.webview.html = createPreviewHtml(
      this.panel.webview,
      this.options.extensionUri,
      this.canLoadRemoteImages(),
    );
  }

  private canLoadRemoteImages(): boolean {
    return vscode.workspace.isTrusted
      && getPreviewSettings(this.documentUri).allowRemoteImages;
  }

  private revealSourceLine(
    message: PreviewScrollMessage,
  ): void {
    if (!getPreviewSettings(this.documentUri).scrollSync) {
      return;
    }

    const editor = vscode.window.visibleTextEditors.find(
      ({ document }) => document.uri.toString() === this.documentUri.toString(),
    );
    if (editor === undefined || editor.document.lineCount === 0) {
      return;
    }

    const sourceLine = Math.min(
      message.sourceLine,
      editor.document.lineCount - 1,
    );
    this.pendingWebviewSequence = message.sequence;
    this.lastEditorSourceLine = sourceLine;
    const position = new vscode.Position(sourceLine, 0);
    editor.revealRange(
      new vscode.Range(position, position),
      vscode.TextEditorRevealType.AtTop,
    );

    // revealRange 在已位於畫面頂端時不一定觸發 visible-range event，
    // 因此仍要回送同一 sequence，讓 Webview 結束本次同步循環。
    if (this.pendingWebviewSequence === message.sequence) {
      this.pendingWebviewSequence = undefined;
      this.postMessage({
        type: 'scrollToSourceLine',
        line: sourceLine,
        sequence: message.sequence,
      });
    }
  }

  private syncCurrentEditor(): void {
    const editor = vscode.window.visibleTextEditors.find(
      ({ document }) => document.uri.toString() === this.documentUri.toString(),
    );
    if (editor !== undefined) {
      this.handleEditorScroll(editor);
    }
  }

  private postMessage(message: ExtensionToWebviewMessage): void {
    const webviewGeneration = this.webviewState.currentGeneration;
    void this.panel.webview.postMessage(message).then(
      (delivered): void => {
        if (!delivered) {
          this.webviewState.markDeliveryFailed(webviewGeneration);
        }
      },
      (error: unknown) => {
        this.webviewState.markDeliveryFailed(webviewGeneration);
        if (!this.disposed) {
          this.options.outputChannel.appendLine(
            `[${new Date().toISOString()}] Preview message failed for `
            + `${this.getDocumentLogLabel()}: ${getErrorMessage(error)}`,
          );
        }
      },
    );
  }

  private createSequence(): number {
    this.nextSequence = this.nextSequence >= Number.MAX_SAFE_INTEGER
      ? 0
      : this.nextSequence + 1;
    return this.nextSequence;
  }

  private cancelActiveRender(): void {
    this.activeRenderController?.abort();
    this.activeRenderController = undefined;
  }

  private getDocumentLogLabel(): string {
    return this.documentUri.with({
      fragment: '',
      query: '',
    }).toString();
  }

  private isStale(requestedRevision: number): boolean {
    return this.disposed
      || !this.renderDebouncer.isCurrent(requestedRevision);
  }

  private disposeSession(disposePanel: boolean): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.cancelActiveRender();
    this.renderDebouncer.dispose();
    this.webviewState.dispose();
    for (const disposable of this.sessionDisposables.splice(0)) {
      disposable.dispose();
    }
    if (disposePanel) {
      this.panel.dispose();
    }
    this.options.onDispose(this);
  }
}
