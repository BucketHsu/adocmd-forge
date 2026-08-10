import path from 'node:path';

import * as vscode from 'vscode';

import { resolveDocumentKind } from '../preview/previewDocument';
import {
  ExportPathPolicyError,
  resolveExportPath,
} from './exportPathPolicy';
import { ExportService } from './exportService';
import { PdfExportProvider } from './pdfExportProvider';
import type {
  ExportFileStat,
  ExportFileSystem,
  ExportFormat,
  ExportOutput,
} from './exportTypes';

export const EXPORT_HTML_COMMAND = 'adocmdForge.exportHtml';
export const EXPORT_STANDALONE_HTML_COMMAND = 'adocmdForge.exportStandaloneHtml';
export const EXPORT_EMBEDDED_HTML_COMMAND = 'adocmdForge.exportEmbeddedHtml';
export const EXPORT_PDF_COMMAND = 'adocmdForge.exportPdf';

export interface ExportRegistration {
  readonly disposables: readonly vscode.Disposable[];
  readonly pdfProvider: PdfExportProvider;
  readonly provider: ExportProvider;
}

export class ExportProvider implements vscode.Disposable {
  private disposed = false;

  public constructor(
    private readonly service: ExportService,
    private readonly outputChannel?: vscode.OutputChannel,
  ) {}

  public async exportActive(
    format: ExportFormat,
    destination?: vscode.Uri,
    documentUri?: vscode.Uri,
  ): Promise<ExportOutput | undefined> {
    if (this.disposed) {
      throw new Error('HTML 匯出服務已停止。');
    }
    const editor = documentUri === undefined
      ? vscode.window.activeTextEditor
      : await vscode.window.showTextDocument(documentUri, {
        preserveFocus: true,
        preview: false,
      });
    if (editor === undefined) {
      throw new Error('請先開啟要匯出的 AsciiDoc 或 Markdown 文件。');
    }

    const kind = resolveDocumentKind(
      editor.document.languageId,
      editor.document.fileName,
    );
    if (kind === undefined) {
      throw new Error('HTML 匯出只支援 .adoc、.asciidoc 與 .md 文件。');
    }
    if (!vscode.workspace.isTrusted) {
      throw new Error('HTML 匯出需要受信任的工作區。');
    }

    const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
    if (
      editor.document.uri.scheme !== 'file'
      || workspaceFolder?.uri.scheme !== 'file'
    ) {
      throw new Error('HTML 匯出目前只支援位於本機工作區的已儲存文件。');
    }

    const target = destination ?? await vscode.window.showSaveDialog({
      defaultUri: createDefaultDestination(editor.document, workspaceFolder.uri),
      filters: { HTML: ['html'] },
      saveLabel: getSaveLabel(format),
    });
    if (target === undefined) {
      return undefined;
    }
    if (target.scheme !== 'file') {
      throw new ExportPathPolicyError('匯出目的地必須是本機工作區內的檔案。');
    }

    // 在檢查既有檔案前先做 lexical workspace boundary validation，避免對
    // workspace 外的使用者選取路徑執行任何檔案系統查詢。
    resolveExportPath(
      editor.document.uri.fsPath,
      workspaceFolder.uri.fsPath,
      target.fsPath,
    );

    const overwrite = await this.confirmOverwrite(target);
    if (!overwrite) {
      return undefined;
    }

    const result = await this.service.export({
      kind,
      source: editor.document.getText(),
      sourcePath: editor.document.uri.fsPath,
      workspaceRootPath: workspaceFolder.uri.fsPath,
      workspaceTrusted: true,
      format,
      destinationPath: target.fsPath,
      overwrite: true,
    });
    this.outputChannel?.appendLine(
      `[${new Date().toISOString()}] Exported ${format} to ${target.fsPath}`,
    );
    // Notifications are deliberately fire-and-forget.  A command must finish
    // as soon as the file is written; waiting for the notification UI can
    // otherwise keep headless Extension Host tests (and automation callers)
    // pending indefinitely when no notification surface is available.
    void vscode.window.showInformationMessage(
      `${getFormatLabel(format)} 已匯出：${path.basename(target.fsPath)}`,
    );
    return result;
  }

  public async exportDocument(
    documentUri: vscode.Uri,
    format: ExportFormat,
    destination?: vscode.Uri,
  ): Promise<ExportOutput | undefined> {
    return this.exportActive(format, destination, documentUri);
  }

  public dispose(): void {
    this.disposed = true;
  }

  private async confirmOverwrite(target: vscode.Uri): Promise<boolean> {
    const fileSystem = new VscodeExportFileSystem();
    const stat = await fileSystem.stat(target.fsPath);
    if (stat.type !== 'file') {
      return stat.type !== 'directory';
    }

    const overwrite = await vscode.window.showWarningMessage(
      `檔案「${path.basename(target.fsPath)}」已存在，是否覆寫？`,
      { modal: true },
      '覆寫',
    );
    return overwrite === '覆寫';
  }
}

export function registerExportCommands(
  commandExecutor: {
    run(commandTitle: string, action: () => Promise<void>): Promise<void>;
  },
  renderer: import('./exportTypes').ExportRenderer,
  outputChannel?: vscode.OutputChannel,
): ExportRegistration {
  const provider = new ExportProvider(
    new ExportService(new VscodeExportFileSystem(), renderer),
    outputChannel,
  );
  const pdfProvider = new PdfExportProvider({
    ...(outputChannel === undefined ? {} : { outputChannel }),
  });
  const commands: readonly [string, string, ExportFormat][] = [
    [EXPORT_HTML_COMMAND, 'Export HTML', 'html'],
    [EXPORT_STANDALONE_HTML_COMMAND, 'Export Standalone HTML', 'standalone-html'],
    [EXPORT_EMBEDDED_HTML_COMMAND, 'Export Embedded HTML', 'embedded-html'],
  ];
  const disposables = [
    provider,
    pdfProvider,
    ...commands.map(([command, title, format]) => (
      vscode.commands.registerCommand(
        command,
        async (resource?: vscode.Uri): Promise<void> => {
          await commandExecutor.run(title, async (): Promise<void> => {
            const documentKind = resolveCommandDocumentKind(resource);
            if (documentKind !== undefined && resource !== undefined) {
              await provider.exportDocument(resource, format);
              return;
            }
            await provider.exportActive(format, resource);
          });
        },
      )
    )),
    vscode.commands.registerCommand(
      EXPORT_PDF_COMMAND,
      async (resource?: vscode.Uri): Promise<void> => {
        await commandExecutor.run('Export PDF', async (): Promise<void> => {
          if (
            resource !== undefined
            && resolveCommandDocumentKind(resource) === 'asciidoc'
          ) {
            await pdfProvider.exportDocument(resource);
            return;
          }
          await pdfProvider.exportActive(resource);
        });
      },
    ),
  ];
  return { disposables, pdfProvider, provider };
}

/**
 * 編輯器標題列會把目前文件 URI 當成命令的第一個參數；命令面板則不會。
 * 只有支援的來源副檔名視為文件 URI，其餘 URI 保留給自動化呼叫指定目的地。
 */
function resolveCommandDocumentKind(
  resource: vscode.Uri | undefined,
): ReturnType<typeof resolveDocumentKind> {
  return resource === undefined
    ? undefined
    : resolveDocumentKind('', resource.fsPath);
}

class VscodeExportFileSystem implements ExportFileSystem {
  public async readFile(filePath: string): Promise<Uint8Array> {
    return vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
  }

  public async writeFile(filePath: string, data: Uint8Array): Promise<void> {
    await vscode.workspace.fs.writeFile(vscode.Uri.file(filePath), data);
  }

  public async createDirectory(directoryPath: string): Promise<void> {
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(directoryPath));
  }

  public async stat(filePath: string): Promise<ExportFileStat> {
    try {
      const stat = await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
      if ((stat.type & vscode.FileType.Directory) !== 0) {
        return { type: 'directory' };
      }
      if ((stat.type & vscode.FileType.File) !== 0) {
        return { type: 'file' };
      }
      return { type: 'unknown' };
    } catch {
      return { type: 'unknown' };
    }
  }
}

function createDefaultDestination(
  document: vscode.TextDocument,
  workspaceUri: vscode.Uri,
): vscode.Uri {
  const sourceName = path.basename(document.fileName, path.extname(document.fileName));
  return vscode.Uri.joinPath(workspaceUri, `${sourceName || 'document'}.html`);
}

function getSaveLabel(format: ExportFormat): string {
  return `匯出${getFormatLabel(format)}`;
}

function getFormatLabel(format: ExportFormat): string {
  switch (format) {
    case 'html':
      return 'HTML';
    case 'standalone-html':
      return 'Standalone HTML';
    case 'embedded-html':
      return 'Embedded HTML';
  }
}
