import { describe, expect, it } from 'vitest';

import {
  analyzeDocument,
  createHeadingId,
  parseAsciiDocOutline,
  parseMarkdownOutline,
} from '../../../src/outline/outlineParser';
import type { AsciiDocProcessor } from '../../../src/outline/outlineParser';

describe('document analysis', (): void => {
  it('解析 Markdown ATX、Setext 與階層，且忽略 fenced code 內容', (): void => {
    const source = [
      '# Document',
      '',
      '```asciidoc',
      '== not a heading',
      '```',
      '',
      'Setext title',
      '============',
      '',
      '## Child',
      '',
      '### Grandchild',
    ].join('\n');

    const analysis = parseMarkdownOutline({
      documentUri: 'untitled:markdown',
      source,
      version: 4,
    });

    expect(analysis.error).toBeUndefined();
    expect(analysis.version).toBe(4);
    expect(analysis.headings.map(({ title, level, sourceLine }) => ({
      title,
      level,
      sourceLine,
    }))).toEqual([
      { title: 'Document', level: 1, sourceLine: 0 },
      { title: 'Setext title', level: 1, sourceLine: 6 },
      { title: 'Child', level: 2, sourceLine: 9 },
      { title: 'Grandchild', level: 3, sourceLine: 11 },
    ]);
    expect(analysis.headings[1]?.range).toEqual({
      start: { line: 6, character: 0 },
      end: { line: 7, character: 12 },
    });
    expect(analysis.outline.map(({ title, children }) => ({
      title,
      children: children.map(({ title: childTitle, children: grandChildren }) => ({
        title: childTitle,
        children: grandChildren.map(({ title: grandChildTitle }) => grandChildTitle),
      })),
    }))).toEqual([
      {
        title: 'Document',
        children: [],
      },
      {
        title: 'Setext title',
        children: [
          {
            title: 'Child',
            children: ['Grandchild'],
          },
        ],
      },
    ]);
    expect([...analysis.anchors]).toEqual([
      'document',
      'setext-title',
      'child',
      'grandchild',
    ]);
  });

  it('支援巢狀 inline token、重複 anchor、換行與空標題', (): void => {
    const analysis = parseMarkdownOutline({
      documentUri: 'untitled:markdown-inline',
      source: [
        '# [Linked **heading**](https://example.com)',
        '',
        '# Linked heading',
        '',
        '# !!!',
        '',
        '#',
      ].join('\r\n'),
    });

    expect(analysis.headings.map(({ title, anchor }) => ({ title, anchor }))).toEqual([
      { title: 'Linked heading', anchor: 'linked-heading' },
      { title: 'Linked heading', anchor: 'linked-heading-1' },
      { title: '!!!', anchor: 'heading' },
    ]);
    expect(analysis.headings[0]?.range.end.line).toBe(0);
  });

  it('解析 AsciiDoc 文件標題、章節與 AST 層級，不把 source block 當章節', (): void => {
    const source = [
      '= Document *Title*',
      ':toc:',
      '',
      '== First',
      '',
      '[source,typescript]',
      '----',
      '=== not a heading',
      '----',
      '',
      '=== Child & More',
      '',
      '==== Grandchild',
    ].join('\n');

    const analysis = parseAsciiDocOutline({
      documentUri: 'file:///workspace/guide.adoc',
      source,
      version: 9,
      sourcePath: '/workspace/guide.adoc',
    });

    expect(analysis.error).toBeUndefined();
    expect(analysis.headings.map(({ title, level, sourceLine }) => ({
      title,
      level,
      sourceLine,
    }))).toEqual([
      { title: 'Document Title', level: 0, sourceLine: 0 },
      { title: 'First', level: 1, sourceLine: 3 },
      { title: 'Child & More', level: 2, sourceLine: 10 },
      { title: 'Grandchild', level: 3, sourceLine: 12 },
    ]);
    expect(analysis.outline[0]?.title).toBe('Document Title');
    expect(analysis.outline[0]?.children.map(({ title }) => title)).toEqual([
      'First',
    ]);
    expect(analysis.outline[0]?.children[0]?.children.map(({ title }) => title)).toEqual([
      'Child & More',
    ]);
    expect([...analysis.anchors]).toEqual([
      'document_title',
      '_first',
      '_child_more',
      '_grandchild',
    ]);
  });

  it('沒有 AsciiDoc 文件標題時仍解析章節，不把第一章捏造為 level 0 標題', (): void => {
    const analysis = analyzeDocument({
      documentUri: 'untitled:asciidoc-sections',
      kind: 'asciidoc',
      source: '正文\n\n== First section\n',
    });

    expect(analysis.headings.map(({ title, level }) => ({ title, level }))).toEqual([
      { title: 'First section', level: 1 },
    ]);
    expect(analysis.outline.map(({ title }) => title)).toEqual(['First section']);
  });

  it('遇到不完整 Asciidoctor AST metadata 時安全略過無法定位的節點', (): void => {
    const validSection = {
      getTitle: (): string => '!!!',
      getLevel: (): number => 1,
      getSourceLocation: (): { getLineNumber: () => number } => ({
        getLineNumber: (): number => 1,
      }),
      getId: undefined,
      getSections: (): null => null,
    };
    const malformedSections = [
      validSection,
      {
        getTitle: (): number => 7,
        getLevel: (): number => 1,
        getSourceLocation: (): undefined => undefined,
      },
      {
        getTitle: (): string => 'ignored level',
        getLevel: (): number => 0,
        getSourceLocation: (): undefined => undefined,
      },
      {
        getTitle: (): string => '',
        getLevel: (): number => 1,
        getSourceLocation: (): undefined => undefined,
      },
      {
        getTitle: (): string => 'no source',
        getLevel: (): number => 1,
        getSourceLocation: (): object => ({}),
      },
      {
        getTitle: (): string => 'throws source',
        getLevel: (): number => 1,
        getSourceLocation: (): never => {
          throw new Error('source metadata failed');
        },
      },
      {
        getTitle: (): never => {
          throw new Error('title metadata failed');
        },
        getLevel: (): number => 1,
        getSourceLocation: (): undefined => undefined,
      },
      42,
    ];
    const processor = {
      load: (): object => ({
        getHeader: (): null => null,
        getSections: (): unknown[] => malformedSections,
      }),
    } as unknown as AsciiDocProcessor;

    const analysis = parseAsciiDocOutline({
      documentUri: 'untitled:malformed-ast',
      source: '== !!!',
    }, processor);

    expect(analysis.error).toBeUndefined();
    expect(analysis.headings.map(({ title, anchor }) => ({ title, anchor }))).toEqual([
      { title: '!!!', anchor: undefined },
    ]);
  });

  it('文件標題缺少 source location 時只使用明確的標題行後援', (): void => {
    const processor = {
      load: (): object => ({
        getHeader: (): object => ({
          getTitle: (): string => 'Fallback title',
        }),
        getSections: (): never[] => [],
      }),
    } as unknown as AsciiDocProcessor;

    const fallback = parseAsciiDocOutline({
      documentUri: 'untitled:fallback',
      source: '= Fallback title',
    }, processor);
    const missing = parseAsciiDocOutline({
      documentUri: 'untitled:missing-location',
      source: 'Fallback title',
    }, processor);

    expect(fallback.headings[0]?.sourceLine).toBe(0);
    expect(missing.headings).toEqual([]);
  });

  it('AsciiDoc 標題會解碼常見字元參照，parser 失敗時回傳 error 分析', (): void => {
    const decoded = parseAsciiDocOutline({
      documentUri: 'untitled:entities',
      source: '= A &amp; B &#67; &#x44; &apos;E&apos;',
    });
    expect(decoded.headings[0]?.title).toBe("A & B C D 'E'");

    const failingProcessor = {
      load: (): never => {
        throw new Error('processor failed');
      },
    } as unknown as AsciiDocProcessor;
    const failed = parseAsciiDocOutline({
      documentUri: 'untitled:processor-error',
      source: '= Error',
    }, failingProcessor);
    expect(failed.error).toBe('processor failed');
    expect(failed.outline).toEqual([]);
  });

  it('以 URI、行號與層級產生可重現的穩定節點 ID', (): void => {
    const first = analyzeDocument({
      documentUri: 'untitled:stable',
      kind: 'markdown',
      source: '# Heading',
    });
    const second = analyzeDocument({
      documentUri: 'untitled:stable',
      kind: 'markdown',
      source: '# Heading',
    });

    expect(first.headings[0]?.id).toBe(second.headings[0]?.id);
    expect(first.headings[0]?.id).toBe(
      createHeadingId('untitled:stable', 0, 1),
    );
  });

  it('空文件回傳空 Outline，不捏造節點', (): void => {
    const analysis = parseMarkdownOutline({
      documentUri: 'untitled:empty',
      source: '',
    });

    expect(analysis.headings).toEqual([]);
    expect(analysis.outline).toEqual([]);
    expect(analysis.anchors.size).toBe(0);
    expect(analysis.error).toBeUndefined();
  });

  it('錯誤輸入不拋出未處理例外，仍回傳完整分析結構', (): void => {
    const analysis = parseAsciiDocOutline({
      documentUri: 'untitled:invalid',
      source: '\u0000\u0000',
    });

    expect(analysis.kind).toBe('asciidoc');
    expect(Array.isArray(analysis.headings)).toBe(true);
    expect(Array.isArray(analysis.outline)).toBe(true);
    expect(Array.isArray(analysis.references)).toBe(true);
  });
});
