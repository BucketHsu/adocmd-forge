export interface PreviewHtmlResources {
  readonly allowRemoteImages: boolean;
  readonly cspSource: string;
  readonly nonce: string;
  readonly scriptUri: string;
  readonly styleUri: string;
}

export function buildPreviewHtml(resources: PreviewHtmlResources): string {
  const imageSources = [
    resources.cspSource,
    ...(resources.allowRemoteImages ? ['https:'] : []),
  ].join(' ');
  const contentSecurityPolicy = [
    "default-src 'none'",
    `img-src ${imageSources}`,
    `style-src ${resources.cspSource}`,
    `font-src ${resources.cspSource}`,
    `script-src 'nonce-${resources.nonce}'`,
  ].join('; ');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta
    http-equiv="Content-Security-Policy"
    content="${escapeAttribute(contentSecurityPolicy)}"
  >
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${escapeAttribute(resources.styleUri)}">
  <title>AdocMD Forge Preview</title>
</head>
<body>
  ${buildPreviewToolbar()}
  <div id="preview-status" role="status" aria-live="polite" hidden></div>
  <main id="preview-content" aria-label="Document preview"></main>
  <script
    type="module"
    defer
    nonce="${resources.nonce}"
    src="${escapeAttribute(resources.scriptUri)}"
  ></script>
</body>
</html>`;
}

function buildPreviewToolbar(): string {
  return `<header id="preview-toolbar" role="toolbar" aria-label="AdocMD Forge 文件工具列">
  <div class="preview-toolbar-group" role="group" aria-label="文字格式">
    ${buildToolbarButton('formatBold', 'B', '粗體')}
    ${buildToolbarButton('formatItalic', 'I', '斜體')}
    ${buildToolbarButton('formatHighlight', 'H', '注目')}
    ${buildToolbarButton('formatCode', '&lt;&gt;', '等寬文字')}
    ${buildToolbarButton('formatStrike', 'S', '刪除線')}
    ${buildToolbarButton('formatSuperscript', 'x²', '上標')}
    ${buildToolbarButton('formatSubscript', 'x₂', '下標')}
  </div>
  <div class="preview-toolbar-divider" aria-hidden="true"></div>
  <div class="preview-toolbar-group" role="group" aria-label="預覽版面">
    ${buildToolbarButton('previewSource', '文字', '只顯示來源文字')}
    ${buildToolbarButton('previewSplit', '分割', '顯示來源文字與預覽')}
    ${buildToolbarButton('previewOnly', '預覽', '只顯示預覽')}
  </div>
  <div class="preview-toolbar-divider" aria-hidden="true"></div>
  <div class="preview-toolbar-group" role="group" aria-label="文件操作">
    ${buildToolbarButton('refreshPreview', '重新整理', '重新產生預覽')}
    ${buildToolbarButton('openSyntaxGuide', '語法', '開啟 AsciiDoc 語法說明')}
    ${buildToolbarButton('exportHtml', 'HTML', '匯出 HTML')}
    ${buildToolbarButton('exportPdf', 'PDF', '匯出 PDF')}
  </div>
</header>`;
}

function buildToolbarButton(
  action: string,
  label: string,
  accessibleLabel: string,
): string {
  return `<button type="button" class="preview-toolbar-button" data-toolbar-action="${action}" aria-label="${accessibleLabel}" title="${accessibleLabel}">${label}</button>`;
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}
