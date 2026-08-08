import { describe, expect, it } from 'vitest';

import { buildPreviewHtml } from '../../../src/preview/previewHtml';

describe('buildPreviewHtml', (): void => {
  it('builds a nonce-protected shell without inline code', (): void => {
    const html = buildPreviewHtml({
      allowRemoteImages: false,
      cspSource: 'vscode-webview:',
      nonce: 'valid-nonce',
      scriptUri: 'vscode-webview://preview.js',
      styleUri: 'vscode-webview://preview.css',
    });

    expect(html).toContain("default-src 'none'");
    expect(html).toContain('img-src vscode-webview:');
    expect(html).not.toContain('img-src vscode-webview: https:');
    expect(html).toContain("script-src 'nonce-valid-nonce'");
    expect(html).toContain('id="preview-content"');
    expect(html).toContain('id="preview-status"');
    expect(html).toContain('id="preview-toolbar"');
    expect(html).toContain('data-toolbar-action="formatBold"');
    expect(html).toContain('data-toolbar-action="previewSplit"');
    expect(html).toContain('data-toolbar-action="exportPdf"');
    expect(html).not.toContain('<style>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('type="module"');
  });

  it('adds HTTPS to the image CSP only when explicitly enabled', (): void => {
    const html = buildPreviewHtml({
      allowRemoteImages: true,
      cspSource: 'vscode-webview:',
      nonce: 'valid-nonce',
      scriptUri: 'vscode-webview://preview.js',
      styleUri: 'vscode-webview://preview.css',
    });

    expect(html).toContain('img-src vscode-webview: https:');
  });
});
