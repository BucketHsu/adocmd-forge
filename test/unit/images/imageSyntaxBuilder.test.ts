import { describe, expect, it } from 'vitest';

import { buildImageSyntax } from '../../../src/images/imageSyntaxBuilder';

describe('image syntax builder', (): void => {
  it('builds AsciiDoc block image syntax with POSIX path', (): void => {
    expect(buildImageSyntax(
      'asciidoc',
      '.\\images\\diagram.png',
      '架構圖',
    )).toBe('image::images/diagram.png[架構圖]');
  });

  it('builds Markdown image syntax and escapes spaces', (): void => {
    expect(buildImageSyntax(
      'markdown',
      'images/diagram (final).png',
      '',
    )).toBe('![diagram (final)](images/diagram%20%28final%29.png)');
  });

  it('escapes syntax delimiters', (): void => {
    expect(buildImageSyntax('asciidoc', 'images/a[1].png', 'a]b')).toBe(
      'image::images/a\\[1\\].png[a\\]b]',
    );
    expect(buildImageSyntax('markdown', 'images/a.png', 'a[b]')).toBe(
      '![a\\[b\\]](images/a.png)',
    );
  });

  it.each(['', '/images/a.png', 'C:\\images\\a.png'])(
    'rejects non-relative path %s',
    (relativePath) => {
      expect(() => buildImageSyntax('markdown', relativePath, 'alt')).toThrow();
    },
  );
});
