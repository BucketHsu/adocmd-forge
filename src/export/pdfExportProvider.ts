import path from 'node:path';

import * as vscode from 'vscode';

import { resolveDocumentKind } from '../preview/previewDocument';
import {
  ExportPathPolicyError,
  resolveExportPath,
} from './exportPathPolicy';
import {
  buildAsciiDocCliArguments,
  defaultAsciiDocCliRunner,
  type AsciiDocCliRunner,
} from './asciidocCli';

export interface PdfExportProviderOptions {
  readonly outputChannel?: vscode.OutputChannel;
  readonly runner?: AsciiDocCliRunner;
}

/**
 * 以使用者本機安裝的 asciidoctor-pdf 產生 PDF。
 *
 * 外部 CLI 是刻意的選擇：PDF converter、Ruby、字型與 diagram extension
 * 都屬於使用者環境，不應被打包進 VSIX 或在 Extension Host 內自行下載。
 */
export class PdfExportProvider implements vscode.Disposable {
  private disposed = false;
  private readonly outputChannel: vscode.OutputChannel | undefined;
  private readonly runner: AsciiDocCliRunner;

  public constructor(options: PdfExportProviderOptions = {}) {
    this.outputChannel = options.outputChannel;
    this.runner = options.runner ?? defaultAsciiDocCliRunner;
  }

  public async exportActive(destination?: vscode.Uri): Promise<void> {
    if (this.disposed) {
      throw new Error('PDF 匯出服務已停止。');
    }

    const editor = vscode.window.activeTextEditor;
    if (editor === undefined) {
      throw new Error('請先開啟要匯出的 AsciiDoc 文件。');
    }
    const kind = resolveDocumentKind(
      editor.document.languageId,
      editor.document.fileName,
    );
    if (kind !== 'asciidoc') {
      throw new Error('PDF 匯出目前只支援 .adoc 與 .asciidoc 文件。');
    }
    if (!vscode.workspace.isTrusted) {
      throw new Error('PDF 匯出需要受信任的工作區。');
    }

    const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
    if (
      editor.document.uri.scheme !== 'file'
      || workspaceFolder?.uri.scheme !== 'file'
    ) {
      throw new Error('PDF 匯出目前只支援位於本機工作區的已儲存文件。');
    }

    const target = destination ?? await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.joinPath(
        workspaceFolder.uri,
        `${path.basename(editor.document.fileName, path.extname(editor.document.fileName)) || 'document'}.pdf`,
      ),
      filters: { PDF: ['pdf'] },
      saveLabel: '匯出 PDF',
    });
    if (target === undefined) {
      return;
    }
    if (target.scheme !== 'file') {
      throw new ExportPathPolicyError('PDF 匯出目的地必須是本機工作區內的檔案。');
    }

    const resolved = resolveExportPath(
      editor.document.uri.fsPath,
      workspaceFolder.uri.fsPath,
      target.fsPath,
    );
    const targetStat = await readFileType(target);
    if (targetStat === 'directory') {
      throw new Error('PDF 匯出目的地必須是檔案，而不是資料夾。');
    }
    if (targetStat === 'file') {
      const overwrite = await vscode.window.showWarningMessage(
        `檔案「${path.basename(target.fsPath)}」已存在，是否覆寫？`,
        { modal: true },
        '覆寫',
      );
      if (overwrite !== '覆寫') {
        return;
      }
    }

    const configuration = vscode.workspace.getConfiguration(
      'adocmdForge.export',
      editor.document.uri,
    );
    const command = configuration.get<string>(
      'asciidoctorPdfCommand',
      'asciidoctor-pdf',
    );
    const configuredArguments = configuration.get<readonly string[]>(
      'asciidoctorPdfArguments',
      [],
    );
    const args = buildAsciiDocCliArguments(
      configuredArguments,
      editor.document.uri.fsPath,
      resolved.destinationPath,
      workspaceFolder.uri.fsPath,
    );

    await this.runner.run({
      args,
      command,
      cwd: workspaceFolder.uri.fsPath,
    });
    if (await readFileType(target) !== 'file') {
      throw new Error('Asciidoctor PDF 指令完成，但沒有產生目標檔案。');
    }

    this.outputChannel?.appendLine(
      `[${new Date().toISOString()}] Exported PDF to ${resolved.destinationPath}`,
    );
    void vscode.window.showInformationMessage(
      `PDF 已匯出：${path.basename(resolved.destinationPath)}`,
    );
  }

  public dispose(): void {
    this.disposed = true;
  }
}

async function readFileType(
  uri: vscode.Uri,
): Promise<'file' | 'directory' | 'unknown'> {
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    if ((stat.type & vscode.FileType.Directory) !== 0) {
      return 'directory';
    }
    if ((stat.type & vscode.FileType.File) !== 0) {
      return 'file';
    }
    return 'unknown';
  } catch {
    return 'unknown';
  }
}
