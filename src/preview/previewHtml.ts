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
  <div id="preview-viewport">
    <div id="preview-status" role="status" aria-live="polite" hidden></div>
    <main id="preview-content" aria-label="Document preview"></main>
  </div>
  <script
    type="module"
    defer
    nonce="${resources.nonce}"
    src="${escapeAttribute(resources.scriptUri)}"
  ></script>
</body>
</html>`;
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}
