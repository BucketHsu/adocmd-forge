import * as vscode from 'vscode';

import {
  applyFormatToEditor,
  type FormatKind,
} from '../commands/registerFormattingCommands';
import type { ExportFormat } from '../export/exportTypes';
import { getPreviewSettings } from '../settings/extensionSettings';
import { createPreviewTitle, resolveDocumentKind } from './previewDocument';
import {
  getContainingDirectoryUri,
  isHostFileSystemUri,
} from './hostFileSystemUri';
import { createAllowedRootPaths } from './previewResource';
import {
  PreviewSession,
  type PreviewRenderer,
} from './previewSession';
import type { PreviewLayout } from './previewLayout';
import type { PreviewToolbarAction } from './previewMessage';

const PREVIEW_VIEW_TYPE = 'adocmdForge.preview';

export interface PreviewManagerOptions {
  readonly extensionUri: vscode.Uri;
  readonly openLink: (
    documentUri: vscode.Uri,
    href: string,
  ) => Promise<void>;
  readonly outputChannel: vscode.OutputChannel;
  readonly exportDocument: (
    documentUri: vscode.Uri,
    format: ExportFormat,
  ) => Promise<void>;
  readonly exportPdf: (documentUri: vscode.Uri) => Promise<void>;
  readonly renderer: PreviewRenderer;
  readonly runToolbarAction: (
    title: string,
    action: () => Promise<void>,
  ) => Promise<void>;
}

export class PreviewManager implements vscode.Disposable {
  private activeSession: PreviewSession | undefined;
  private disposed = false;
  private readonly managerDisposables: vscode.Disposable[] = [];
  private readonly sessions = new Map<string, PreviewSession>();

  public constructor(private readonly options: PreviewManagerOptions) {
    this.managerDisposables.push(
      vscode.workspace.onDidChangeTextDocument(({ document }) => {
        this.sessions.get(document.uri.toString())?.handleDocumentChange();
      }),
      vscode.window.onDidChangeTextEditorVisibleRanges(({ textEditor }) => {
        this.sessions
          .get(textEditor.document.uri.toString())
          ?.handleEditorScroll(textEditor);
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        for (const session of this.sessions.values()) {
          session.handleConfigurationChange(event);
        }
      }),
      vscode.workspace.onDidGrantWorkspaceTrust(() => {
        for (const session of this.sessions.values()) {
          session.updateResourceRoots(
            this.createAllowedRootPaths(session.documentUri),
            this.createResourceRoots(session.documentUri),
          );
        }
      }),
    );
  }

  public async openPreview(resource?: vscode.Uri): Promise<void> {
    this.ensureNotDisposed();
    const document = await this.resolveDocument(resource);
    const kind = resolveDocumentKind(document.languageId, document.fileName);
    if (kind === undefined) {
      throw new Error(
        'Open an .adoc, .asciidoc, or .md document before opening preview.',
      );
    }

    const documentKey = document.uri.toString();
    const existingSession = this.sessions.get(documentKey);
    if (existingSession !== undefined) {
      existingSession.panel.reveal(existingSession.panel.viewColumn, true);
      this.activeSession = existingSession;
      existingSession.refresh();
      return;
    }

    const { openToSide } = getPreviewSettings(document.uri);
    const resourceRoots = this.createResourceRoots(document.uri);
    const panel = vscode.window.createWebviewPanel(
      PREVIEW_VIEW_TYPE,
      createPreviewTitle(document.fileName),
      {
        preserveFocus: true,
        viewColumn: openToSide
          ? vscode.ViewColumn.Beside
          : vscode.ViewColumn.Active,
      },
      {
        enableFindWidget: true,
        enableScripts: true,
        localResourceRoots: resourceRoots,
        retainContextWhenHidden: false,
      },
    );

    const session = new PreviewSession({
      allowedResourceRootPaths: this.createAllowedRootPaths(document.uri),
      documentUri: document.uri,
      extensionUri: this.options.extensionUri,
      onActivate: (activatedSession): void => {
        this.activeSession = activatedSession;
      },
      onDispose: (disposedSession): void => {
        this.removeSession(disposedSession);
      },
      onToolbarAction: (action): Promise<void> => (
        this.handleToolbarAction(document.uri, action)
      ),
      openLink: this.options.openLink,
      outputChannel: this.options.outputChannel,
      panel,
      renderer: this.options.renderer,
    });
    this.sessions.set(documentKey, session);
    this.activeSession = session;
  }

  public async refreshPreview(): Promise<void> {
    this.ensureNotDisposed();
    const activeDocumentKey = vscode.window.activeTextEditor?.document.uri
      .toString();
    const sourceSession = activeDocumentKey === undefined
      ? undefined
      : this.sessions.get(activeDocumentKey);
    const session = sourceSession ?? this.activeSession;
    if (session === undefined) {
      await this.openPreview();
      return;
    }

    session.refresh();
  }

  public async setLayout(layout: PreviewLayout): Promise<void> {
    this.ensureNotDisposed();
    const session = this.activeSession;
    if (layout === 'source') {
      if (session === undefined) {
        return;
      }

      const documentUri = session.documentUri;
      session.dispose();
      await vscode.window.showTextDocument(documentUri, {
        preview: false,
      });
      return;
    }

    if (session === undefined) {
      await this.openPreview();
      this.activeSession?.revealLayout(layout);
      return;
    }

    session.revealLayout(layout);
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    for (const disposable of this.managerDisposables.splice(0)) {
      disposable.dispose();
    }
    for (const session of [...this.sessions.values()]) {
      session.dispose();
    }
    this.sessions.clear();
    this.activeSession = undefined;
  }

  private async resolveDocument(
    resource: vscode.Uri | undefined,
  ): Promise<vscode.TextDocument> {
    if (resource !== undefined) {
      return vscode.workspace.openTextDocument(resource);
    }

    const activeDocument = vscode.window.activeTextEditor?.document;
    if (activeDocument === undefined) {
      throw new Error(
        'No active AsciiDoc or Markdown document is available.',
      );
    }

    return activeDocument;
  }

  private createResourceRoots(documentUri: vscode.Uri): vscode.Uri[] {
    const roots = [
      vscode.Uri.joinPath(this.options.extensionUri, 'dist', 'media'),
    ];
    if (!vscode.workspace.isTrusted) {
      return roots;
    }

    const workspaceFolder = vscode.workspace.getWorkspaceFolder(documentUri);
    if (workspaceFolder !== undefined) {
      roots.push(workspaceFolder.uri);
    }
    if (isHostFileSystemUri(documentUri)) {
      roots.push(getContainingDirectoryUri(documentUri));
    }

    return deduplicateUris(roots);
  }

  private createAllowedRootPaths(documentUri: vscode.Uri): string[] {
    if (!vscode.workspace.isTrusted) {
      return [];
    }

    const workspaceFolder = vscode.workspace.getWorkspaceFolder(documentUri);
    const workspaceRootPaths = (
      workspaceFolder !== undefined
      && isHostFileSystemUri(workspaceFolder.uri)
    )
      ? [
          workspaceFolder.uri.fsPath,
        ]
      : [];
    return createAllowedRootPaths(
      isHostFileSystemUri(documentUri) ? documentUri.fsPath : undefined,
      workspaceRootPaths,
    );
  }

  private removeSession(session: PreviewSession): void {
    const documentKey = session.documentUri.toString();
    if (this.sessions.get(documentKey) === session) {
      this.sessions.delete(documentKey);
    }
    if (this.activeSession === session) {
      this.activeSession = undefined;
    }
  }

  private async handleToolbarAction(
    documentUri: vscode.Uri,
    action: PreviewToolbarAction,
  ): Promise<void> {
    const session = this.sessions.get(documentUri.toString());
    if (session === undefined) {
      return;
    }
    this.activeSession = session;

    await this.options.runToolbarAction(
      getToolbarActionTitle(action),
      async (): Promise<void> => {
        const formatKind = getFormatKind(action);
        if (formatKind !== undefined) {
          const editor = await vscode.window.showTextDocument(documentUri, {
            preserveFocus: true,
            preview: false,
          });
          await applyFormatToEditor(editor, formatKind);
          return;
        }

        switch (action) {
          case 'refreshPreview':
            session.refresh();
            return;
          case 'previewSource':
            await this.setLayout('source');
            return;
          case 'previewSplit':
            await this.setLayout('split');
            return;
          case 'previewOnly':
            await this.setLayout('preview');
            return;
          case 'openSyntaxGuide':
            await vscode.commands.executeCommand(
              'adocmdForge.openSyntaxGuide',
            );
            return;
          case 'exportHtml':
            await this.options.exportDocument(documentUri, 'html');
            return;
          case 'exportStandaloneHtml':
            await this.options.exportDocument(
              documentUri,
              'standalone-html',
            );
            return;
          case 'exportEmbeddedHtml':
            await this.options.exportDocument(
              documentUri,
              'embedded-html',
            );
            return;
          case 'exportPdf':
            await this.options.exportPdf(documentUri);
            return;
        }
      },
    );
  }

  private ensureNotDisposed(): void {
    if (this.disposed) {
      throw new Error('Preview manager has already been disposed.');
    }
  }
}

function getFormatKind(action: PreviewToolbarAction): FormatKind | undefined {
  switch (action) {
    case 'formatBold':
      return 'bold';
    case 'formatItalic':
      return 'italic';
    case 'formatHighlight':
      return 'highlight';
    case 'formatCode':
      return 'code';
    case 'formatStrike':
      return 'strike';
    case 'formatSuperscript':
      return 'superscript';
    case 'formatSubscript':
      return 'subscript';
    default:
      return undefined;
  }
}

function getToolbarActionTitle(action: PreviewToolbarAction): string {
  switch (action) {
    case 'formatBold':
      return 'Bold';
    case 'formatItalic':
      return 'Italic';
    case 'formatHighlight':
      return 'Highlight';
    case 'formatCode':
      return 'Inline Code';
    case 'formatStrike':
      return 'Strike Through';
    case 'formatSuperscript':
      return 'Superscript';
    case 'formatSubscript':
      return 'Subscript';
    case 'previewSource':
      return 'Show Source Only';
    case 'previewSplit':
      return 'Show Source and Preview';
    case 'previewOnly':
      return 'Show Preview Only';
    case 'refreshPreview':
      return 'Refresh Preview';
    case 'openSyntaxGuide':
      return 'Open AsciiDoc Syntax Guide';
    case 'exportHtml':
      return 'Export HTML';
    case 'exportStandaloneHtml':
      return 'Export Standalone HTML';
    case 'exportEmbeddedHtml':
      return 'Export Embedded HTML';
    case 'exportPdf':
      return 'Export PDF';
  }
}

function deduplicateUris(uris: readonly vscode.Uri[]): vscode.Uri[] {
  const uniqueUris = new Map<string, vscode.Uri>();
  for (const uri of uris) {
    uniqueUris.set(uri.toString(), uri);
  }
  return [...uniqueUris.values()];
}
