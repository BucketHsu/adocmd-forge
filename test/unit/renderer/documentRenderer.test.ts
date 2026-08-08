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

  it('renders common AsciiDoc blocks without depending on optional source locations', async (): Promise<void> => {
    const result = await render({
      kind: 'asciidoc',
      source: [
        '= Stable Preview',
        ':name: AdocMD Forge',
        '',
        '== Section',
        '',
        '* first item',
        '* second item',
        '',
        '|===',
        '| Name | Value',
        '| {name} | preview',
        '|===',
        '',
        'xref:missing.adoc[]',
        '',
        'image::missing.png[Missing image]',
        '',
        '[source,typescript]',
        '----',
        'const value = 1;',
        '----',
      ].join('\n'),
    });

    expect(result.title).toBe('Stable Preview');
    expect(result.html).toContain('<h1 data-source-line="0">Stable Preview</h1>');
    expect(result.html).toContain('class="ulist"');
    expect(result.html).toContain('<table');
    expect(result.html).toContain('missing.html');
    expect(result.html).toContain('<img src="missing.png" alt="Missing image" />');
    expect(result.html).toContain('const value = 1;');
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

  it('supports nested include selection while keeping the workspace boundary', async (): Promise<void> => {
    const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'adocmd-forge-nested-'));

    try {
      const chapterDirectory = path.join(temporaryDirectory, 'chapters');
      await mkdir(chapterDirectory);
      await writeFile(
        path.join(chapterDirectory, 'nested.adoc'),
        'outside\n// tag::visible[]\nvisible *content*\n// end::visible[]\n',
        'utf8',
      );
      await writeFile(
        path.join(chapterDirectory, 'introduction.adoc'),
        'include::nested.adoc[tags=visible]',
        'utf8',
      );

      const result = await render({
        allowLocalIncludes: true,
        allowedIncludeRootPaths: [temporaryDirectory],
        kind: 'asciidoc',
        source: [
          '= Include Selection',
          '',
          'include::chapters/introduction.adoc[]',
        ].join('\n'),
        sourcePath: path.join(temporaryDirectory, 'guide.adoc'),
      });

      expect(result.html).toContain('visible <strong>content</strong>');
      expect(result.html).not.toContain('outside');
      expect(result.messages ?? []).toEqual([]);
    } finally {
      await rm(temporaryDirectory, {
        force: true,
        recursive: true,
      });
    }
  });

  it('rejects includes outside the allowed workspace roots', async (): Promise<void> => {
    const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'adocmd-forge-boundary-'));
    const outsideDirectory = await mkdtemp(path.join(tmpdir(), 'adocmd-forge-outside-'));

    try {
      await writeFile(
        path.join(outsideDirectory, 'secret.adoc'),
        'secret content',
        'utf8',
      );
      const result = await render({
        allowLocalIncludes: true,
        allowedIncludeRootPaths: [temporaryDirectory],
        kind: 'asciidoc',
        source: `include::../${path.basename(outsideDirectory)}/secret.adoc[]`,
        sourcePath: path.join(temporaryDirectory, 'guide.adoc'),
      });

      expect(result.html).not.toContain('secret content');
      expect(result.messages?.some((message) => (
        message.severity === 'error'
        && message.message.includes('outside')
      ))).toBe(true);
    } finally {
      await rm(temporaryDirectory, {
        force: true,
        recursive: true,
      });
      await rm(outsideDirectory, {
        force: true,
        recursive: true,
      });
    }
  });

  it('stops recursive include cycles with a structured error', async (): Promise<void> => {
    const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'adocmd-forge-cycle-'));

    try {
      await writeFile(
        path.join(temporaryDirectory, 'a.adoc'),
        'include::b.adoc[]',
        'utf8',
      );
      await writeFile(
        path.join(temporaryDirectory, 'b.adoc'),
        'include::a.adoc[]',
        'utf8',
      );
      const result = await render({
        allowLocalIncludes: true,
        allowedIncludeRootPaths: [temporaryDirectory],
        kind: 'asciidoc',
        source: 'include::a.adoc[]',
        sourcePath: path.join(temporaryDirectory, 'guide.adoc'),
      });

      expect(result.html).not.toContain('Maximum call stack');
      expect(result.messages?.some((message) => (
        message.severity === 'error'
        && message.message.includes('循環引用')
      ))).toBe(true);
    } finally {
      await rm(temporaryDirectory, {
        force: true,
        recursive: true,
      });
    }
  });

  it('reports malformed and missing include tags without aborting the preview', async (): Promise<void> => {
    const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'adocmd-forge-tags-'));

    try {
      await writeFile(
        path.join(temporaryDirectory, 'malformed.adoc'),
        '// tag::wanted[]\n// end::other[]\n',
        'utf8',
      );
      const result = await render({
        allowLocalIncludes: true,
        allowedIncludeRootPaths: [temporaryDirectory],
        kind: 'asciidoc',
        source: [
          'include::malformed.adoc[tags=wanted]',
          'include::malformed.adoc[tags=missing]',
        ].join('\n'),
        sourcePath: path.join(temporaryDirectory, 'guide.adoc'),
      });

      expect(result.html).toBeTypeOf('string');
      expect(result.messages?.some((message) => (
        message.severity === 'warning'
        && message.message.includes('mismatched-end-tag')
        && message.message.includes('預期 wanted')
      ))).toBe(true);
      expect(result.messages?.some((message) => (
        message.severity === 'warning'
        && message.message.includes('missing-tag')
      ))).toBe(true);
    } finally {
      await rm(temporaryDirectory, {
        force: true,
        recursive: true,
      });
    }
  });

  it('resolves a trusted AsciiDoc stylesheet relative to the document', async (): Promise<void> => {
    const sourcePath = path.join(
      path.resolve('workspace'),
      'docs',
      'guide.adoc',
    );

    const result = await render({
      allowLocalIncludes: true,
      kind: 'asciidoc',
      source: [
        ':stylesheet: ../stylesheets/colony.css',
        '',
        '= Styled Guide',
        '',
        'Content.',
      ].join('\n'),
      sourcePath,
    });

    expect(result.stylesheets).toEqual([
      path.join(path.dirname(path.dirname(sourcePath)), 'stylesheets', 'colony.css'),
    ]);
  });

  it('supports stylesdir and does not expose stylesheets for untrusted or untitled documents', async (): Promise<void> => {
    const source = [
      ':stylesdir: ../stylesheets',
      ':stylesheet: colony.css',
      '',
      '= Styled Guide',
    ].join('\n');
    const sourcePath = path.join(path.resolve('workspace'), 'docs', 'guide.adoc');

    const trustedResult = await render({
      allowLocalIncludes: true,
      kind: 'asciidoc',
      source,
      sourcePath,
    });
    const untrustedResult = await render({
      allowLocalIncludes: false,
      kind: 'asciidoc',
      source,
      sourcePath,
    });
    const untitledResult = await render({
      kind: 'asciidoc',
      source,
    });

    expect(trustedResult.stylesheets).toEqual([
      path.join(path.dirname(path.dirname(sourcePath)), 'stylesheets', 'colony.css'),
    ]);
    expect(untrustedResult.stylesheets).toBeUndefined();
    expect(untitledResult.stylesheets).toBeUndefined();
  });

  it('ignores stylesheet URI and absolute-path attributes', async (): Promise<void> => {
    const sourcePath = path.join(path.resolve('workspace'), 'guide.adoc');
    const result = await render({
      allowLocalIncludes: true,
      kind: 'asciidoc',
      source: [
        ':stylesheet: https://example.com/colony.css',
        '',
        '= Unsafe Stylesheet',
      ].join('\n'),
      sourcePath,
    });

    expect(result.stylesheets).toBeUndefined();
  });

  it('renders the preferred book header while preserving its local stylesheet', async (): Promise<void> => {
    const sourcePath = path.join(
      path.resolve('workspace'),
      'manual',
      'system-guide.adoc',
    );
    const result = await render({
      allowLocalIncludes: true,
      kind: 'asciidoc',
      source: [
        '= 新北市地政整合作業系統 WEB 版改版建置作業案: 系統建置與維護手冊',
        'V1.5, 2026-07-08',
        ':revnumber: 1.5',
        ':revdate: 中華民國115年07月08日',
        ':experimental:',
        ':icons: font',
        ':icon-set: fas',
        ':sectnums:',
        ':toc: left',
        ':toc-title: 目錄',
        ':toclevels: 3',
        ':imagesdir:',
        ':sourcedir:',
        ':saltdir:',
        ':authors: 晶茂資訊科技股份有限公司',
        ':logo: images/logo.png',
        ':cover-background: images/front-cover.png',
        ':background: images/background.png',
        ':back-cover-image: image:../images/back-cover.png[]',
        ':doctype: book',
        ':media: prepress',
        ':chapter-signifier: 章',
        ':chapter-refsig: 章',
        ':table-caption: 表',
        ':figure-caption: 圖',
        ':source-highlighter: rouge',
        ':stylesheet: ../stylesheets/colony.css',
        ':pdf-theme: ../pdf-theme.yml',
        ':pdf-fontsdir: C:/Windows/Fonts',
        ':scripts: cjk',
        ':optimize:',
        ':chapter-label:',
        ':iconfont-remote: true',
        ':iconfont-fontawesome:',
        ':favicon: images/favicon.ico',
        ':last-update-label!:',
        '',
        '== 第一章',
        '',
        '內容可以正常預覽。',
      ].join('\n'),
      sourcePath,
    });

    expect(result.title).toContain('新北市地政整合作業系統');
    expect(result.html).toContain('內容可以正常預覽。');
    expect(result.stylesheets).toEqual([
      path.join(path.dirname(sourcePath), '..', 'stylesheets', 'colony.css'),
    ]);
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

  it('does not fail when an AST source location has no getLineNumber method', async (): Promise<void> => {
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
    ).mockReturnValue({
      getFile: (): undefined => undefined,
    });

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

  it('does not fail when reading an AST source location throws', async (): Promise<void> => {
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
    ).mockImplementation(() => {
      throw new Error('source location unavailable');
    });

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

  it('keeps logger messages when their source location is incomplete', async (): Promise<void> => {
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
        getSourceLocation: (): object => ({
          getFile: (): undefined => undefined,
        }),
        getText: (): string => 'Warning with an incomplete source location.',
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
          message: 'Warning with an incomplete source location.',
          severity: 'warning',
        },
      ]);
    } finally {
      getMessages.mockRestore();
      createLogger.mockRestore();
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
