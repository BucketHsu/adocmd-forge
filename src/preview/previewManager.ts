import * as vscode from 'vscode';

import { getPreviewSettings } from '../settings/extensionSettings';
import { createPreviewTitle, resolveDocumentKind } from './previewDocument';
import {
  getContainingDirectoryUri,
  isHostFileSystemUri,
} from './hostFileSystemUri';
import {
  createAllowedRootPaths,
  isPathWithinRoot,
} from './previewResource';
import {
  PreviewSession,
  type PreviewRenderer,
} from './previewSession';
import type { PreviewLayout } from './previewLayout';

const PREVIEW_VIEW_TYPE = 'adocmdForge.preview';
const DEPENDENCY_REFRESH_DELAY = 100;

export interface PreviewManagerOptions {
  readonly extensionUri: vscode.Uri;
  readonly openLink: (
    documentUri: vscode.Uri,
    href: string,
  ) => Promise<void>;
  readonly outputChannel: vscode.OutputChannel;
  readonly renderer: PreviewRenderer;
  readonly resourceChangeEvent?: vscode.Event<vscode.Uri>;
}

export class PreviewManager implements vscode.Disposable {
  private activeSession: PreviewSession | undefined;
  private disposed = false;
  private readonly managerDisposables: vscode.Disposable[] = [];
  private readonly dependencyRefreshTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
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
      vscode.window.onDidChangeTextEditorSelection(({ textEditor }) => {
        this.sessions
          .get(textEditor.document.uri.toString())
          ?.handleEditorSelection(textEditor);
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
            this.createAllowedStylesheetRootPaths(session.documentUri),
            this.createResourceRoots(session.documentUri),
          );
        }
      }),
    );
    if (options.resourceChangeEvent !== undefined) {
      this.managerDisposables.push(options.resourceChangeEvent((uri) => {
        this.handleDependencyChange(uri);
      }));
    }
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
      allowedStylesheetRootPaths: this.createAllowedStylesheetRootPaths(
        document.uri,
      ),
      documentUri: document.uri,
      extensionUri: this.options.extensionUri,
      onActivate: (activatedSession): void => {
        this.activeSession = activatedSession;
      },
      onDispose: (disposedSession): void => {
        this.removeSession(disposedSession);
      },
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
    for (const timer of this.dependencyRefreshTimers.values()) {
      clearTimeout(timer);
    }
    this.dependencyRefreshTimers.clear();
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

  private createAllowedStylesheetRootPaths(documentUri: vscode.Uri): string[] {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(documentUri);
    const workspaceRootPaths = (
      workspaceFolder !== undefined
      && isHostFileSystemUri(workspaceFolder.uri)
    )
      ? [workspaceFolder.uri.fsPath]
      : [];

    return createAllowedRootPaths(
      isHostFileSystemUri(documentUri) ? documentUri.fsPath : undefined,
      workspaceRootPaths,
    );
  }

  private removeSession(session: PreviewSession): void {
    const documentKey = session.documentUri.toString();
    const timer = this.dependencyRefreshTimers.get(documentKey);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.dependencyRefreshTimers.delete(documentKey);
    }
    if (this.sessions.get(documentKey) === session) {
      this.sessions.delete(documentKey);
    }
    if (this.activeSession === session) {
      this.activeSession = undefined;
    }
  }

  private ensureNotDisposed(): void {
    if (this.disposed) {
      throw new Error('Preview manager has already been disposed.');
    }
  }

  private handleDependencyChange(uri: vscode.Uri): void {
    if (this.disposed) {
      return;
    }
    for (const [documentKey, session] of this.sessions) {
      if (
        documentKey === uri.toString()
        || !this.isRelatedResource(session.documentUri, uri)
      ) {
        continue;
      }
      const previous = this.dependencyRefreshTimers.get(documentKey);
      if (previous !== undefined) {
        clearTimeout(previous);
      }
      this.dependencyRefreshTimers.set(documentKey, setTimeout((): void => {
        this.dependencyRefreshTimers.delete(documentKey);
        session.refresh();
      }, DEPENDENCY_REFRESH_DELAY));
    }
  }

  private isRelatedResource(
    documentUri: vscode.Uri,
    resourceUri: vscode.Uri,
  ): boolean {
    if (isHostFileSystemUri(documentUri) && isHostFileSystemUri(resourceUri)) {
      return this.createAllowedStylesheetRootPaths(documentUri).some(
        (rootPath) => isPathWithinRoot(resourceUri.fsPath, rootPath),
      );
    }
    const documentWorkspace = vscode.workspace.getWorkspaceFolder(documentUri);
    const resourceWorkspace = vscode.workspace.getWorkspaceFolder(resourceUri);
    const documentWorkspaceUri = documentWorkspace?.uri.toString();
    return documentWorkspaceUri !== undefined
      && documentWorkspaceUri === resourceWorkspace?.uri.toString();
  }
}

function deduplicateUris(uris: readonly vscode.Uri[]): vscode.Uri[] {
  const uniqueUris = new Map<string, vscode.Uri>();
  for (const uri of uris) {
    uniqueUris.set(uri.toString(), uri);
  }
  return [...uniqueUris.values()];
}
