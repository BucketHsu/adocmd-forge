import path from 'node:path';

import * as vscode from 'vscode';

const HOST_FILE_SYSTEM_SCHEMES = new Set([
  'file',
  'vscode-remote',
]);

/**
 * 判斷 URI 的 fsPath 是否可由目前執行 workspace extension 的 Node.js host 存取。
 */
export function isHostFileSystemUri(uri: vscode.Uri): boolean {
  return HOST_FILE_SYSTEM_SCHEMES.has(uri.scheme);
}

export function getContainingDirectoryUri(uri: vscode.Uri): vscode.Uri {
  return uri.with({
    fragment: '',
    path: path.posix.dirname(uri.path),
    query: '',
  });
}

/**
 * 將 Extension Host 上的絕對檔案路徑轉回與來源相同 scheme/authority 的 URI。
 */
export function createHostFileSystemUri(
  sourceUri: vscode.Uri,
  absoluteFilePath: string,
): vscode.Uri {
  const fileUri = vscode.Uri.file(absoluteFilePath);
  return sourceUri.scheme === 'file'
    ? fileUri
    : sourceUri.with({
        fragment: '',
        path: fileUri.path,
        query: '',
      });
}
