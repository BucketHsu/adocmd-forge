import * as vscode from 'vscode';

import { resolveDocumentKind } from '../preview/previewDocument';
import { getLinkCheckerSettings } from '../settings/extensionSettings';
import { getErrorMessage } from '../utility/errorMessage';
import {
  LinkCheckCancelledError,
  LinkCheckerService,
  type LinkCheckFileSystem,
  type LinkDiagnostic,
} from './linkCheckerService';

export const LINK_DIAGNOSTIC_COLLECTION_NAME = 'adocmd-forge';
export const VALIDATE_LINKS_COMMAND = 'adocmdForge.validateLinks';

export interface LinkDiagnosticProviderOptions {
  readonly service?: LinkCheckerService;
  readonly updateDelay?: number;
  readonly collection?: vscode.DiagnosticCollection;
  readonly fileSystem?: LinkCheckFileSystem;
  readonly outputChannel?: vscode.OutputChannel;
}

export interface LinkDiagnosticRegistration {
  readonly provider: LinkDiagnosticProvider;
  readonly collection: vscode.DiagnosticCollection;
  readonly disposables: readonly vscode.Disposable[];
}

/**
 * VS Code Diagnostics adapter。Provider 只處理事件、取消、Range 轉換與 collection
 * 生命週期，檔案引用規則由 LinkCheckerService 負責。
 */
export class LinkDiagnosticProvider implements vscode.Disposable {
  public readonly collection: vscode.DiagnosticCollection;
  private readonly service: LinkCheckerService;
  private readonly outputChannel: vscode.OutputChannel | undefined;
  private readonly updateDelay: number;
  private readonly subscriptions: vscode.Disposable[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private controller: AbortController | undefined;
  private revision = 0;
  private activeDocumentUri: vscode.Uri | undefined;
  private disposed = false;

  public constructor(options: LinkDiagnosticProviderOptions = {}) {
    this.collection = options.collection
      ?? vscode.languages.createDiagnosticCollection(LINK_DIAGNOSTIC_COLLECTION_NAME);
    this.service = options.service
      ?? new LinkCheckerService(options.fileSystem ?? new VscodeLinkCheckFileSystem());
    this.outputChannel = options.outputChannel;
    this.updateDelay = normalizeDelay(options.updateDelay ?? 150);
    this.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        this.schedule(editor?.document);
      }),
      vscode.workspace.onDidChangeTextDocument(({ document }) => {
        if (document.uri.toString() === vscode.window.activeTextEditor?.document.uri.toString()) {
          this.schedule(document);
        }
      }),
      vscode.workspace.onDidCloseTextDocument((document) => {
        this.collection.delete(document.uri);
        if (document.uri.toString() === vscode.window.activeTextEditor?.document.uri.toString()) {
          this.cancelPendingWork();
        }
      }),
    );
    this.schedule(vscode.window.activeTextEditor?.document);
  }

  public getDiagnostics(uri: vscode.Uri): readonly vscode.Diagnostic[] {
    return this.collection.get(uri) ?? [];
  }

  public async validateActive(): Promise<void> {
    const document = vscode.window.activeTextEditor?.document;
    if (document === undefined || resolveDocumentKind(document.languageId, document.fileName) === undefined) {
      return;
    }
    this.cancelPendingWork();
    const revision = ++this.revision;
    this.controller = new AbortController();
    await this.analyze(document, revision, this.controller.signal);
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.cancelPendingWork();
    for (const subscription of this.subscriptions.splice(0)) {
      subscription.dispose();
    }
    this.collection.dispose();
  }

  private schedule(document: vscode.TextDocument | undefined): void {
    if (this.disposed) {
      return;
    }
    this.cancelPendingWork();
    const previousDocumentUri = this.activeDocumentUri;
    if (previousDocumentUri?.toString() !== document?.uri.toString()) {
      if (previousDocumentUri !== undefined) {
        this.collection.delete(previousDocumentUri);
      }
    }
    this.activeDocumentUri = document?.uri;
    if (document === undefined) {
      return;
    }

    const kind = resolveDocumentKind(document.languageId, document.fileName);
    if (kind === undefined) {
      this.collection.delete(document.uri);
      return;
    }

    this.collection.delete(document.uri);
    const revision = ++this.revision;
    this.timer = setTimeout((): void => {
      this.timer = undefined;
      if (this.disposed || revision !== this.revision) {
        return;
      }
      this.controller = new AbortController();
      void this.analyze(document, revision, this.controller.signal);
    }, this.updateDelay);
  }

  private async analyze(
    document: vscode.TextDocument,
    revision: number,
    signal: AbortSignal,
  ): Promise<void> {
    try {
      const kind = resolveDocumentKind(document.languageId, document.fileName);
      if (kind === undefined) {
        return;
      }
      const workspaceRoots = vscode.workspace.workspaceFolders?.map(({ uri }) => uri.fsPath) ?? [];
      const diagnostics = await this.service.check({
        documentUri: document.uri.toString(),
        source: document.getText(),
        kind,
        version: document.version,
        ...(document.uri.scheme === 'file' ? { sourcePath: document.uri.fsPath } : {}),
        workspaceRoots,
        workspaceTrusted: vscode.workspace.isTrusted,
      }, signal);
      if (
        !this.disposed
        && revision === this.revision
        && document.version === vscode.window.activeTextEditor?.document.version
      ) {
        this.collection.set(
          document.uri,
          diagnostics.map(toVscodeDiagnostic),
        );
      }
    } catch (error) {
      if (error instanceof LinkCheckCancelledError || signal.aborted || this.disposed) {
        return;
      }
      this.outputChannel?.appendLine(
        `[${new Date().toISOString()}] Link Checker: ${getErrorMessage(error)}`,
      );
    }
  }

  private cancelPendingWork(): void {
    this.revision += 1;
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.controller?.abort();
    this.controller = undefined;
  }
}

export function registerLinkDiagnostics(
  commandExecutor: {
    run(commandTitle: string, action: () => Promise<void>): Promise<void>;
  },
  outputChannel?: vscode.OutputChannel,
): LinkDiagnosticRegistration {
  const provider = new LinkDiagnosticProvider({
    updateDelay: getLinkCheckerSettings().updateDelay,
    ...(outputChannel === undefined ? {} : { outputChannel }),
  });
  const command = vscode.commands.registerCommand(
    VALIDATE_LINKS_COMMAND,
    async (): Promise<void> => {
      await commandExecutor.run('Validate Links', async (): Promise<void> => {
        await provider.validateActive();
      });
    },
  );
  return {
    provider,
    collection: provider.collection,
    disposables: [provider, command],
  };
}

function toVscodeDiagnostic(diagnostic: LinkDiagnostic): vscode.Diagnostic {
  const range = new vscode.Range(
    diagnostic.range.start.line,
    diagnostic.range.start.character,
    diagnostic.range.end.line,
    diagnostic.range.end.character,
  );
  const severity = diagnostic.severity === 'error'
    ? vscode.DiagnosticSeverity.Error
    : diagnostic.severity === 'warning'
      ? vscode.DiagnosticSeverity.Warning
      : vscode.DiagnosticSeverity.Information;
  const result = new vscode.Diagnostic(range, diagnostic.message, severity);
  result.code = diagnostic.code;
  result.source = LINK_DIAGNOSTIC_COLLECTION_NAME;
  return result;
}

class VscodeLinkCheckFileSystem implements LinkCheckFileSystem {
  public async stat(filePath: string): Promise<'file' | 'directory' | 'unknown'> {
    try {
      const stat = await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
      return (stat.type & vscode.FileType.File) !== 0 ? 'file' : 'directory';
    } catch {
      return 'unknown';
    }
  }

  public async readFile(filePath: string): Promise<string> {
    const content = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
    return new TextDecoder().decode(content);
  }
}

function normalizeDelay(value: number): number {
  return Number.isFinite(value) ? Math.min(2_000, Math.max(50, Math.round(value))) : 150;
}
