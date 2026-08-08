import type { ExportFormat } from './exportTypes';

const EXPORT_STYLE = `
:root { color-scheme: light dark; }
body { margin: 0 auto; max-width: 52rem; padding: 2rem; font-family: system-ui, sans-serif; line-height: 1.6; }
img { max-width: 100%; height: auto; }
pre { overflow-x: auto; padding: 1rem; background: Canvas; }
code { font-family: ui-monospace, monospace; }
table { border-collapse: collapse; }
th, td { border: 1px solid currentColor; padding: .35rem .6rem; }
`;

export function buildExportHtml(
  format: ExportFormat,
  fragment: string,
  title: string,
): string {
  if (format === 'embedded-html') {
    return fragment;
  }

  return `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>${EXPORT_STYLE}</style>
</head>
<body>
<main>${fragment}</main>
</body>
</html>
`;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
