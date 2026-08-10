import { describe, expect, it } from 'vitest';

import {
  createAsciiDocFoldingRanges,
  createDocumentSections,
} from '../../../src/outline/documentStructure';
import { analyzeDocument } from '../../../src/outline/outlineParser';

describe('documentStructure', (): void => {
  const source = [
    '= Guide',
    '',
    '== First',
    '',
    '=== Child',
    'Text',
    '',
    '== Second',
    '[source,typescript]',
    '----',
    'const value = 1;',
    '----',
    '',
    '////',
    'hidden',
    '////',
  ].join('\n');
  const analysis = analyzeDocument({
    documentUri: 'file:///guide.adoc',
    kind: 'asciidoc',
    source,
    sourcePath: '/guide.adoc',
  });

  it('creates hierarchical native document sections with full ranges', (): void => {
    const sections = createDocumentSections(analysis, source);

    expect(sections).toHaveLength(1);
    expect(sections[0]).toMatchObject({
      title: 'Guide',
      level: 0,
      range: {
        start: { line: 0, character: 0 },
        end: { line: 15, character: 4 },
      },
    });
    expect(sections[0]?.children.map(({ title }) => title)).toEqual([
      'First',
      'Second',
    ]);
    expect(sections[0]?.children[0]?.children[0]).toMatchObject({
      title: 'Child',
      range: {
        start: { line: 4, character: 0 },
        end: { line: 6, character: 0 },
      },
    });
  });

  it('creates section, delimited block, and comment folding ranges', (): void => {
    expect(createAsciiDocFoldingRanges(analysis, source)).toEqual([
      { startLine: 0, endLine: 15, kind: 'region' },
      { startLine: 2, endLine: 6, kind: 'region' },
      { startLine: 4, endLine: 6, kind: 'region' },
      { startLine: 7, endLine: 15, kind: 'region' },
      { startLine: 9, endLine: 11, kind: 'region' },
      { startLine: 13, endLine: 15, kind: 'comment' },
    ]);
  });

  it('ignores unmatched block delimiters', (): void => {
    const unmatched = '== Section\n----\ntext';
    const unmatchedAnalysis = analyzeDocument({
      documentUri: 'file:///unmatched.adoc',
      kind: 'asciidoc',
      source: '== Section\ntext',
    });

    expect(createAsciiDocFoldingRanges(unmatchedAnalysis, unmatched)).toEqual([
      { startLine: 0, endLine: 2, kind: 'region' },
    ]);
  });
});
