import { describe, expect, it } from 'vitest';

import { ASCIIDOC_SYNTAX_GUIDE } from '../../../src/language/asciidocSyntaxGuide';

describe('AsciiDoc syntax guide', (): void => {
  it('contains the complete first-release topic set', (): void => {
    for (const topic of [
      '標題與段落',
      '文字樣式',
      '清單與 Checklist',
      'Source Block',
      'Admonition',
      '表格',
      'Link、xref 與 anchor',
      'Image 與 include',
      'Attribute 與 TOC',
    ]) {
      expect(ASCIIDOC_SYNTAX_GUIDE).toContain(topic);
    }
  });

  it('is a runnable AsciiDoc document', (): void => {
    expect(ASCIIDOC_SYNTAX_GUIDE.startsWith('= AsciiDoc 語法說明')).toBe(true);
    expect(ASCIIDOC_SYNTAX_GUIDE).toContain('[source,asciidoc]');
    expect(ASCIIDOC_SYNTAX_GUIDE).toContain('image::images/example.png');
    expect(ASCIIDOC_SYNTAX_GUIDE).toContain('include::chapter.adoc');
  });
});
