import { describe, expect, it } from 'vitest';

import {
  parseDocumentReferences,
  parseExplicitAnchors,
} from '../../../src/diagnostics/linkReferenceParser';

describe('link reference parser', (): void => {
  it('解析 Markdown link/image，保留 target range 並忽略 fenced code', (): void => {
    const source = [
      '# Guide',
      '',
      '[Guide](guide.md#intro)',
      '![Logo](images/logo.png "Logo")',
      '',
      '```markdown',
      '[Ignored](missing.md)',
      '![Ignored](missing.png)',
      '```',
      '',
      '[External](https://example.com/docs)',
      '[Spaced](<other file.md#section>)',
    ].join('\n');

    const references = parseDocumentReferences({ source, kind: 'markdown' });
    expect(references.map(({ kind, target, range }) => ({
      kind,
      target,
      range,
    }))).toEqual([
      {
        kind: 'link',
        target: 'guide.md#intro',
        range: {
          start: { line: 2, character: 8 },
          end: { line: 2, character: 22 },
        },
      },
      {
        kind: 'image',
        target: 'images/logo.png',
        range: {
          start: { line: 3, character: 8 },
          end: { line: 3, character: 23 },
        },
      },
      {
        kind: 'link',
        target: 'https://example.com/docs',
        range: {
          start: { line: 10, character: 11 },
          end: { line: 10, character: 35 },
        },
      },
      {
        kind: 'link',
        target: 'other file.md#section',
        range: {
          start: { line: 11, character: 10 },
          end: { line: 11, character: 31 },
        },
      },
    ]);
  });

  it('解析 AsciiDoc xref/include/image、shorthand xref，且忽略 source block', (): void => {
    const source = [
      'xref:guide.adoc#intro[指南]',
      'include::parts/chapter.adoc[leveloffset=+1]',
      'image::images/logo.png[Logo]',
      '<<#intro,Introduction>>',
      '----',
      'xref:missing.adoc[Ignored]',
      '----',
    ].join('\n');

    const references = parseDocumentReferences({ source, kind: 'asciidoc' });
    expect(references.map(({ kind, target }) => ({ kind, target }))).toEqual([
      { kind: 'xref', target: 'guide.adoc#intro' },
      { kind: 'include', target: 'parts/chapter.adoc' },
      { kind: 'image', target: 'images/logo.png' },
      { kind: 'xref', target: '#intro' },
    ]);
    expect(references[0]?.range).toEqual({
      start: { line: 0, character: 5 },
      end: { line: 0, character: 21 },
    });
  });

  it('解析 Markdown 與 AsciiDoc explicit anchors，排除 fenced code', (): void => {
    const markdown = parseExplicitAnchors([
      '<a id="ignored-html"></a>',
      '{#markdown-anchor}',
      '```',
      '{#ignored}',
      '```',
    ].join('\n'), 'markdown');
    const asciidoc = parseExplicitAnchors([
      '[[chapter-one]]',
      '[#styled-anchor]',
      'anchor:macro-anchor[]',
      '....',
      '[[ignored]]',
      '....',
    ].join('\n'), 'asciidoc');

    expect([...markdown]).toEqual(['markdown-anchor']);
    expect([...asciidoc]).toEqual([
      'chapter-one',
      'styled-anchor',
      'macro-anchor',
    ]);
  });
});
