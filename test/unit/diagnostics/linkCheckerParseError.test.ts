import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/outline/outlineParser', () => ({
  analyzeDocument: vi.fn(({ kind }: { readonly kind: 'markdown' | 'asciidoc' }) => ({
    documentUri: 'untitled:parse-error',
    version: 0,
    kind,
    headings: [],
    outline: [],
    anchors: new Set<string>(),
    references: [],
    error: 'synthetic parser failure',
  })),
}));

import { LinkCheckerService } from '../../../src/diagnostics/linkCheckerService';

describe('LinkCheckerService parser failure', (): void => {
  it('以 Markdown reference 產生 parse-error diagnostic', async (): Promise<void> => {
    const service = new LinkCheckerService({
      stat: (): Promise<'unknown'> => Promise.resolve('unknown'),
      readFile: (): Promise<string> => Promise.resolve(''),
    });
    const diagnostics = await service.check({
      documentUri: 'untitled:parse-error',
      kind: 'markdown',
      source: '# Broken',
    });

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      code: 'parse-error',
      message: '文件解析失敗，無法完整檢查引用：synthetic parser failure',
      reference: { kind: 'link', target: '' },
    });
  });

  it('以 AsciiDoc reference 產生 parse-error diagnostic', async (): Promise<void> => {
    const service = new LinkCheckerService({
      stat: (): Promise<'unknown'> => Promise.resolve('unknown'),
      readFile: (): Promise<string> => Promise.resolve(''),
    });
    const diagnostics = await service.check({
      documentUri: 'untitled:parse-error-adoc',
      kind: 'asciidoc',
      source: '= Broken',
    });

    expect(diagnostics[0]?.reference.kind).toBe('xref');
  });
});
