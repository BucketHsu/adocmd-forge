import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import type { LoggerMessage } from '@asciidoctor/core';

import {
  render,
  type RenderResult,
} from '../../../src/renderer/documentRenderer';
import createAsciidoctorRuntime from '../../../src/renderer/asciidoctorRuntime.cjs';

describe('document renderer', (): void => {
  it('renders Markdown with a plain-text title and 0-based block source lines', async (): Promise<void> => {
    const source = [
      '# Forge & `Docs`',
      '',
      'A **bold** paragraph.',
      '',
      '```typescript',
      'const value = 1;',
      '```',
    ].join('\n');

    const result = await render({
      kind: 'markdown',
      source,
    });

    expect(result.title).toBe('Forge & Docs');
    expect(result.lineCount).toBe(7);
    expect(result.html).toContain('<h1 data-source-line="0">Forge &amp; <code>Docs</code></h1>');
    expect(result.html).toContain('<p data-source-line="2">A <strong>bold</strong> paragraph.</p>');
    expect(result.html).toContain('<pre data-source-line="4"><code class="language-typescript">');
  });

  it('keeps Markdown HTML, linkify, and typographer features disabled', async (): Promise<void> => {
    const result = await render({
      kind: 'markdown',
      source: [
        '<script>alert("xss")</script>',
        '',
        'https://example.com -- "quoted"',
      ].join('\n'),
    });

    expect(result.html).toContain('&lt;script&gt;alert("xss")&lt;/script&gt;');
    expect(result.html).not.toContain('<script');
    expect(result.html).not.toContain('<a ');
    expect(result.html).toContain('https://example.com -- "quoted"');
  });

  it('renders AsciiDoc safely and maps AST blocks to 0-based source lines', async (): Promise<void> => {
    const source = [
      '= Forge & Docs',
      '',
      '== Section',
      '',
      'A *bold* paragraph.',
      '',
      '[source,typescript]',
      '----',
      'const value = 1;',
      '----',
    ].join('\n');

    const result = await render({
      kind: 'asciidoc',
      source,
    });

    expect(result.title).toBe('Forge & Docs');
    expect(result.lineCount).toBe(10);
    expect(result.html).toContain('<h1 data-source-line="0">Forge &amp; Docs</h1>');
    expect(result.html).toMatch(/<div data-source-line="2" class="sect1">/u);
    expect(result.html).toMatch(/<div data-source-line="4" class="paragraph">/u);
    expect(result.html).toMatch(/<div data-source-line="[67]" class="listingblock">/u);
    expect(result.html).toContain('<strong>bold</strong>');
  });

  it('removes raw AsciiDoc passthrough scripts, event handlers, and dangerous URIs', async (): Promise<void> => {
    const source = [
      '= Safe Preview',
      '',
      '++++',
      '<script>alert("xss")</script>',
      '<img src="javascript:alert(1)" onerror="alert(2)" alt="unsafe">',
      '++++',
    ].join('\n');

    const result = await render({
      kind: 'asciidoc',
      source,
    });

    expect(result.html).not.toContain('<script');
    expect(result.html).not.toContain('alert("xss")');
    expect(result.html).not.toContain('onerror');
    expect(result.html).not.toContain('javascript:');
    expect(result.html).toContain('<img alt="unsafe" />');
  });

  it('supports safe includes relative to sourcePath', async (): Promise<void> => {
    const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'adocmd-forge-renderer-'));

    try {
      const chapterDirectory = path.join(temporaryDirectory, 'chapters');
      await mkdir(chapterDirectory);
      await writeFile(
        path.join(chapterDirectory, 'introduction.adoc'),
        'Included *content*.',
        'utf8',
      );

      const result = await render({
        allowLocalIncludes: true,
        kind: 'asciidoc',
        source: [
          '= Include Test',
          '',
          'include::chapters/introduction.adoc[]',
        ].join('\n'),
        sourcePath: path.join(temporaryDirectory, 'guide.adoc'),
      });

      expect(result.html).toContain('Included <strong>content</strong>.');
    } finally {
      await rm(temporaryDirectory, {
        force: true,
        recursive: true,
      });
    }
  });

  it('captures a missing include as a structured message without console output', async (): Promise<void> => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {
      // 此測試只驗證 renderer 不會使用全域 console。
    });
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {
      // 此測試只驗證 renderer 不會使用全域 console。
    });

    try {
      const result = await render({
        allowLocalIncludes: true,
        kind: 'asciidoc',
        source: 'include::missing.adoc[]',
        sourcePath: path.join(tmpdir(), 'adocmd-forge-missing-include.adoc'),
      });

      expect(result.messages).toHaveLength(1);
      const message = result.messages?.[0];
      expect(message?.message).toContain('missing.adoc');
      expect(message?.severity).toBe('error');
      expect(message?.sourceLine).toBe(0);
      expect(consoleError).not.toHaveBeenCalled();
      expect(consoleWarn).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
      consoleWarn.mockRestore();
    }
  });

  it('renders logger messages that do not provide a source location', async (): Promise<void> => {
    const asciidoctor = createAsciidoctorRuntime();
    const memoryLogger = asciidoctor.MemoryLogger.create();
    const createLogger = vi.spyOn(
      asciidoctor.MemoryLogger,
      'create',
    ).mockReturnValue(memoryLogger);
    const getMessages = vi.spyOn(
      memoryLogger,
      'getMessages',
    ).mockReturnValue([
      {
        getSeverity: (): string => 'WARN',
        getSourceLocation: (): undefined => undefined,
        getText: (): string => 'Warning without a source location.',
      } as unknown as LoggerMessage,
    ]);

    try {
      const result = await render({
        kind: 'asciidoc',
        source: 'Content.',
      });

      expect(result.html).toContain('Content.');
      expect(result.messages).toEqual([
        {
          message: 'Warning without a source location.',
          severity: 'warning',
        },
      ]);
    } finally {
      getMessages.mockRestore();
      createLogger.mockRestore();
    }
  });

  it('renders AST blocks that do not provide a source location', async (): Promise<void> => {
    const asciidoctor = createAsciidoctorRuntime();
    const parsed = asciidoctor.load('Probe.', {
      sourcemap: true,
    });
    const probeBlock = parsed.findBy({
      context: 'paragraph',
    })[0];
    if (probeBlock === undefined) {
      throw new Error('Expected an Asciidoctor paragraph probe block.');
    }

    const abstractBlockPrototype = Object.getPrototypeOf(
      Object.getPrototypeOf(probeBlock) as object,
    ) as {
      getSourceLocation(): unknown;
    };
    const getSourceLocation = vi.spyOn(
      abstractBlockPrototype,
      'getSourceLocation',
    ).mockReturnValue(undefined);

    try {
      const result = await render({
        kind: 'asciidoc',
        source: '= Title\n\nContent.',
      });

      expect(result.title).toBe('Title');
      expect(result.html).toContain('<h1>Title</h1>');
      expect(result.html).toContain('Content.');
      expect(result.html).not.toContain('data-source-line');
    } finally {
      getSourceLocation.mockRestore();
    }
  });

  it.each([
    'asciidoc',
    'markdown',
  ] as const)('handles an empty %s document', async (kind): Promise<void> => {
    const result: RenderResult = await render({
      kind,
      source: '',
    });

    expect(result).toEqual({
      html: '',
      lineCount: 1,
    });
  });

  it('counts CRLF and trailing empty lines like a text editor', async (): Promise<void> => {
    const result = await render({
      kind: 'markdown',
      source: 'first\r\nsecond\r\n',
    });

    expect(result.lineCount).toBe(3);
  });
});
