import { describe, expect, it } from 'vitest';

import { sanitizeRenderedHtml } from '../../../src/renderer/documentRenderer';

describe('rendered HTML sanitizer', (): void => {
  it('preserves document HTML while removing executable content', (): void => {
    const html = sanitizeRenderedHtml([
      '<section><p class="lead" data-source-line="3" onclick="alert(1)">Text</p></section>',
      '<script>alert(2)</script>',
      '<style>body { display: none; }</style>',
    ].join(''));

    expect(html).toContain('<p class="lead" data-source-line="3">Text</p>');
    expect(html).not.toContain('<section');
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('alert(2)');
    expect(html).not.toContain('<style');
  });

  it('allows only relative, HTTP(S), and mailto links', (): void => {
    const html = sanitizeRenderedHtml([
      '<a href="../guide.html">relative</a>',
      '<a href="#section">anchor</a>',
      '<a href="https://example.com/guide">https</a>',
      '<a href="mailto:docs@example.com">mail</a>',
      '<a href="http://example.com">http</a>',
      '<a href="javascript:alert(1)">script</a>',
      '<a href="//example.com">protocol-relative</a>',
    ].join(''));

    expect(html).toContain('href="../guide.html"');
    expect(html).toContain('href="#section"');
    expect(html).toContain('href="https://example.com/guide"');
    expect(html).toContain('href="mailto:docs@example.com"');
    expect(html).toContain('href="http://example.com"');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('href="//example.com"');
  });

  it('allows relative and HTTPS image sources only by default', (): void => {
    const html = sanitizeRenderedHtml([
      '<img src="images/diagram.png" alt="relative">',
      '<img src="https://example.com/diagram.png" alt="https">',
      '<img src="http://example.com/diagram.png" alt="http">',
      '<img src="data:image/svg+xml,unsafe" alt="data">',
      '<img src="mailto:docs@example.com" alt="mail">',
    ].join(''));

    expect(html).toContain('src="images/diagram.png"');
    expect(html).toContain('src="https://example.com/diagram.png"');
    expect(html).not.toContain('src="http://example.com/diagram.png"');
    expect(html).not.toContain('src="data:image');
    expect(html).not.toContain('src="mailto:');
  });

  it('isolates additional image schemes from links and blocks dangerous schemes', (): void => {
    const html = sanitizeRenderedHtml([
      '<img src="adocmd-webview:/diagram.png" alt="custom">',
      '<a href="adocmd-webview:/guide">custom link</a>',
      '<img src="javascript:alert(1)" alt="script">',
    ].join(''), {
      additionalImageSchemes: [
        'adocmd-webview',
        'javascript',
      ],
    });

    expect(html).toContain('src="adocmd-webview:/diagram.png"');
    expect(html).not.toContain('href="adocmd-webview:/guide"');
    expect(html).not.toContain('javascript:');
  });

  it('applies resource transformers before enforcing the fixed safety policy', (): void => {
    const html = sanitizeRenderedHtml(
      '<img src="images/diagram.png" alt="diagram"><a href="./guide">Guide</a>',
      {
        additionalImageSchemes: [
          'adocmd-webview',
        ],
        transformTags: {
          a: (tagName, attributes) => ({
            attribs: {
              ...attributes,
              href: 'javascript:alert(1)',
              onclick: 'alert(2)',
            },
            tagName,
          }),
          img: (tagName, attributes) => ({
            attribs: {
              ...attributes,
              onerror: 'alert(3)',
              src: 'adocmd-webview:/diagram.png',
            },
            tagName,
          }),
        },
      },
    );

    expect(html).toContain('<img src="adocmd-webview:/diagram.png" alt="diagram" />');
    expect(html).toContain('<a>Guide</a>');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('onerror');
  });
});
