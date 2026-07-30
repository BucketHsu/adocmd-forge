import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';

import * as vscode from 'vscode';

import { getErrorMessage } from '../utility/errorMessage';
import {
  createHostFileSystemUri,
  isHostFileSystemUri,
} from './hostFileSystemUri';
import { resolvePreviewNavigation } from './previewNavigation';
import {
  createAllowedRootPaths,
  isPathWithinRoot,
} from './previewResource';

const TEXT_DOCUMENT_EXTENSIONS = new Set([
  '.adoc',
  '.asciidoc',
  '.md',
]);

export class PreviewLinkOpener {
  public constructor(private readonly outputChannel: vscode.OutputChannel) {}

  public async open(documentUri: vscode.Uri, href: string): Promise<void> {
    const hasHostFileSystem = vscode.workspace.isTrusted
      && isHostFileSystemUri(documentUri);
    const allowedRootPaths = hasHostFileSystem
      ? createAllowedRootPaths(
          documentUri.fsPath,
          getFileWorkspaceRootPaths(documentUri),
        )
      : [];
    const navigation = resolvePreviewNavigation({
      allowedRootPaths,
      href,
      ...(
        hasHostFileSystem
          ? {
              sourceFilePath: documentUri.fsPath,
            }
          : {}
      ),
    });

    if (navigation.kind === 'rejected') {
      this.outputChannel.appendLine(
        `[${new Date().toISOString()}] Preview link blocked `
        + `(${navigation.reason}).`,
      );
      await vscode.window.showWarningMessage(
        'AdocMD Forge blocked an unsafe or unsupported preview link.',
      );
      return;
    }

    try {
      if (navigation.kind === 'external') {
        const opened = await vscode.env.openExternal(
          vscode.Uri.parse(navigation.href, true),
        );
        if (!opened) {
          throw new Error('VS Code declined to open the external link.');
        }
        return;
      }

      const physicalFilePath = await this.resolvePhysicalFile(
        navigation.filePath,
        allowedRootPaths,
      );
      const fileUri = createHostFileSystemUri(
        documentUri,
        physicalFilePath,
      );
      if (
        navigation.sourceLine !== null
        || TEXT_DOCUMENT_EXTENSIONS.has(
          path.extname(physicalFilePath).toLowerCase(),
        )
      ) {
        await this.openTextDocument(fileUri, navigation.sourceLine);
      } else {
        await vscode.commands.executeCommand('vscode.open', fileUri);
      }
    } catch (error) {
      const message = getErrorMessage(error);
      this.outputChannel.appendLine(
        `[${new Date().toISOString()}] Unable to open preview link: ${message}`,
      );
      await vscode.window.showErrorMessage(
        `Unable to open preview link: ${message}`,
      );
    }
  }

  private async resolvePhysicalFile(
    requestedPath: string,
    allowedRootPaths: readonly string[],
  ): Promise<string> {
    const physicalFilePath = await realpath(requestedPath);
    const fileStat = await stat(physicalFilePath);
    if (!fileStat.isFile()) {
      throw new Error('The preview link does not point to a file.');
    }

    const physicalRootPaths = (
      await Promise.all(allowedRootPaths.map(async (rootPath) => {
        try {
          return await realpath(rootPath);
        } catch {
          return undefined;
        }
      }))
    ).filter((rootPath): rootPath is string => rootPath !== undefined);
    if (
      !physicalRootPaths.some(
        (rootPath) => isPathWithinRoot(physicalFilePath, rootPath),
      )
    ) {
      throw new Error('The preview link resolves outside the allowed roots.');
    }

    return physicalFilePath;
  }

  private async openTextDocument(
    fileUri: vscode.Uri,
    sourceLine: number | null,
  ): Promise<void> {
    const document = await vscode.workspace.openTextDocument(fileUri);
    const editor = await vscode.window.showTextDocument(document);
    if (sourceLine === null || document.lineCount === 0) {
      return;
    }

    const line = Math.min(sourceLine, document.lineCount - 1);
    const position = new vscode.Position(line, 0);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(
      new vscode.Range(position, position),
      vscode.TextEditorRevealType.InCenterIfOutsideViewport,
    );
  }
}

function getFileWorkspaceRootPaths(documentUri: vscode.Uri): string[] {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(documentUri);
  return (
    workspaceFolder !== undefined
    && isHostFileSystemUri(workspaceFolder.uri)
  )
    ? [
        workspaceFolder.uri.fsPath,
      ]
    : [];
}
