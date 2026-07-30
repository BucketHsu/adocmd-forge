import * as vscode from 'vscode';

import { createNonce } from '../utility/nonce';
import { buildPreviewHtml } from './previewHtml';

export function createPreviewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  allowRemoteImages: boolean,
): string {
  const nonce = createNonce();
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'dist', 'media', 'preview.js'),
  );
  const styleUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'dist', 'media', 'preview.css'),
  );
  return buildPreviewHtml({
    allowRemoteImages,
    cspSource: webview.cspSource,
    nonce,
    scriptUri: scriptUri.toString(),
    styleUri: styleUri.toString(),
  });
}
