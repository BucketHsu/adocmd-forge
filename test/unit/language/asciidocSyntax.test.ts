import { describe, expect, it } from 'vitest';

import {
  ASCII_DOC_SYNTAX_ENTRIES,
  getAsciiDocSyntaxEntry,
} from '../../../src/language/asciidocSyntax';

describe('AsciiDoc syntax catalogue', (): void => {
  it('contains every syntax covered by the first language-help release', (): void => {
    const ids = ASCII_DOC_SYNTAX_ENTRIES.map(({ id }) => id);

    expect(ids).toEqual([
      'heading',
      'paragraph',
      'unorderedList',
      'orderedList',
      'checklist',
      'sourceBlock',
      'admonition',
      'table',
      'link',
      'xref',
      'anchor',
      'image',
      'include',
      'attribute',
      'toc',
      'bold',
      'italic',
      'monospace',
    ]);
  });

  it('provides Traditional Chinese documentation and insertable snippets', (): void => {
    for (const syntaxEntry of ASCII_DOC_SYNTAX_ENTRIES) {
      expect(syntaxEntry.documentation.length).toBeGreaterThan(0);
      expect(syntaxEntry.insertText.length).toBeGreaterThan(0);
      expect(syntaxEntry.documentation).toMatch(/[\u4e00-\u9fff]/u);
    }
  });

  it('looks up entries by stable identifier', (): void => {
    expect(getAsciiDocSyntaxEntry('image')?.label).toBe('Image');
    expect(getAsciiDocSyntaxEntry('heading')?.contexts).toContain('heading');
  });

  it('keeps the monospace snippet tight around its text', (): void => {
    expect(getAsciiDocSyntaxEntry('monospace')?.insertText).toBe(
      '`${1:等寬文字}`',
    );
  });
});
