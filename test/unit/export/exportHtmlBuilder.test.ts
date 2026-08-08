import { describe, expect, it } from 'vitest';

import { buildExportHtml, escapeHtml } from '../../../src/export/exportHtmlBuilder';

describe('exportHtmlBuilder', (): void => {
  it('builds a complete HTML document for HTML and Standalone HTML', (): void => {
    const html = buildExportHtml('html', '<h1>標題</h1>', 'A & B');
    const standalone = buildExportHtml('standalone-html', '<p>內容</p>', '文件');

    expect(html).toContain('<!doctype html>');
    expect(html).toContain('<style>');
    expect(html).toContain('<main><h1>標題</h1></main>');
    expect(html).toContain('<title>A &amp; B</title>');
    expect(standalone).toContain('<meta charset="utf-8">');
    expect(standalone).toContain('<body>');
  });

  it('returns only the fragment for Embedded HTML', (): void => {
    const fragment = '<p>可嵌入內容</p>';
    const result = buildExportHtml('embedded-html', fragment, '忽略');

    expect(result).toBe(fragment);
    expect(result).not.toContain('<!doctype');
    expect(result).not.toContain('<html');
    expect(result).not.toContain('<head');
    expect(result).not.toContain('<body');
  });

  it('escapes HTML text and attributes', (): void => {
    expect(escapeHtml(`<x> & "'`)).toBe('&lt;x&gt; &amp; &quot;&#39;');
  });
});
