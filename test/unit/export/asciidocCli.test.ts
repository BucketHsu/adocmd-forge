import { describe, expect, it } from 'vitest';

import {
  buildAsciiDocCliArguments,
  findWindowsCommandPaths,
  resolveAbsoluteWindowsCommandPaths,
  resolveCliInvocation,
  runAsciiDocCli,
  selectWindowsRubyInvocation,
} from '../../../src/export/asciidocCli';

describe('buildAsciiDocCliArguments', (): void => {
  it('appends output and source paths when defaults are used', (): void => {
    expect(buildAsciiDocCliArguments(
      [],
      '/workspace/docs/guide.adoc',
      '/workspace/out/guide.pdf',
      '/workspace',
    )).toEqual([
      '-o',
      '/workspace/out/guide.pdf',
      '/workspace/docs/guide.adoc',
    ]);
  });

  it('expands placeholders without duplicating configured paths', (): void => {
    expect(buildAsciiDocCliArguments(
      [
        '-r',
        'asciidoctor-diagram',
        '-a',
        'data-uri',
        '-o',
        '{destination}',
        '{source}',
      ],
      '/workspace/docs/guide.adoc',
      '/workspace/out/guide.html',
      '/workspace',
    )).toEqual([
      '-r',
      'asciidoctor-diagram',
      '-a',
      'data-uri',
      '-o',
      '/workspace/out/guide.html',
      '/workspace/docs/guide.adoc',
    ]);
  });

  it('expands workspace placeholders in arbitrary arguments', (): void => {
    expect(buildAsciiDocCliArguments(
      ['-a', 'pdf-theme={workspace}/pdf-theme.yml'],
      '/workspace/docs/guide.adoc',
      '/workspace/out/guide.pdf',
      '/workspace',
    )).toEqual([
      '-a',
      'pdf-theme=/workspace/pdf-theme.yml',
      '-o',
      '/workspace/out/guide.pdf',
      '/workspace/docs/guide.adoc',
    ]);
  });

  it('resolves when the external command exits successfully', async (): Promise<void> => {
    await expect(runAsciiDocCli({
      args: ['-e', 'process.exit(0)'],
      command: process.execPath,
      cwd: process.cwd(),
    })).resolves.toBeUndefined();
  });

  it('returns stderr when the external command exits with an error', async (): Promise<void> => {
    await expect(runAsciiDocCli({
      args: [
        '-e',
        'process.stderr.write("cli failed"); process.exit(2)',
      ],
      command: process.execPath,
      cwd: process.cwd(),
    })).rejects.toThrow('cli failed');
  });

  it('converts a missing executable into a normal Error', async (): Promise<void> => {
    await expect(runAsciiDocCli({
      args: [],
      command: 'adocmd-forge-command-that-does-not-exist',
      cwd: process.cwd(),
    })).rejects.toThrow('找不到命令');
  });

  it('selects the Ruby executable beside a Windows RubyGems script', (): void => {
    expect(selectWindowsRubyInvocation(
      [
        'C:\\Users\\tester\\WindowsApps\\asciidoctor-pdf.bat',
        'D:\\Ruby32-x64\\bin\\asciidoctor-pdf',
        'D:\\Ruby32-x64\\bin\\asciidoctor-pdf.bat',
      ],
      ['D:\\Ruby32-x64\\bin\\ruby.exe'],
    )).toEqual({
      rubyPath: 'D:\\Ruby32-x64\\bin\\ruby.exe',
      scriptPath: 'D:\\Ruby32-x64\\bin\\asciidoctor-pdf',
    });
  });

  it('does not pair a Ruby executable from an unrelated directory', (): void => {
    expect(selectWindowsRubyInvocation(
      ['C:\\Tools\\asciidoctor-pdf.bat'],
      ['D:\\Ruby32-x64\\bin\\ruby.exe'],
    )).toBeUndefined();
  });

  it('keeps native commands unchanged outside Windows', async (): Promise<void> => {
    await expect(resolveCliInvocation(
      'asciidoctor-pdf',
      ['--version'],
      { platform: 'linux' },
    )).resolves.toEqual({
      args: ['--version'],
      command: 'asciidoctor-pdf',
    });
  });

  it.each(['.exe', '.com'])('keeps Windows %s executables unchanged', async (extension): Promise<void> => {
    await expect(resolveCliInvocation(
      `C:\\Tools\\asciidoctor-pdf${extension}`,
      ['--version'],
      { platform: 'win32' },
    )).resolves.toEqual({
      args: ['--version'],
      command: `C:\\Tools\\asciidoctor-pdf${extension}`,
    });
  });

  it('resolves a Windows RubyGems command without using a shell', async (): Promise<void> => {
    const findCommandPaths = (command: string): Promise<readonly string[]> => Promise.resolve(
      command === 'ruby.exe'
        ? ['D:\\Ruby\\bin\\ruby.exe']
        : ['D:\\Ruby\\bin\\asciidoctor-pdf.bat'],
    );

    await expect(resolveCliInvocation(
      'asciidoctor-pdf',
      ['--version'],
      { findCommandPaths, platform: 'win32' },
    )).resolves.toEqual({
      args: ['D:\\Ruby\\bin\\asciidoctor-pdf', '--version'],
      command: 'D:\\Ruby\\bin\\ruby.exe',
    });
  });

  it('falls back to the configured command when no Ruby pair exists', async (): Promise<void> => {
    await expect(resolveCliInvocation(
      'custom-pdf',
      ['--version'],
      {
        findCommandPaths: (): Promise<readonly string[]> => Promise.resolve([]),
        platform: 'win32',
      },
    )).resolves.toEqual({
      args: ['--version'],
      command: 'custom-pdf',
    });
  });

  it('uses the absolute-command resolver for Windows wrapper paths', async (): Promise<void> => {
    await expect(resolveCliInvocation(
      'D:\\Ruby\\bin\\asciidoctor-pdf.bat',
      ['--version'],
      {
        findCommandPaths: (command): Promise<readonly string[]> => Promise.resolve(
          command === 'ruby.exe' ? ['D:\\Ruby\\bin\\ruby.exe'] : [],
        ),
        platform: 'win32',
        resolveAbsoluteCommandPaths: (): Promise<readonly string[]> => Promise.resolve([
          'D:\\Ruby\\bin\\asciidoctor-pdf',
        ]),
      },
    )).resolves.toEqual({
      args: ['D:\\Ruby\\bin\\asciidoctor-pdf', '--version'],
      command: 'D:\\Ruby\\bin\\ruby.exe',
    });
  });

  it('handles absolute companion scripts that exist or are missing', async (): Promise<void> => {
    await expect(resolveAbsoluteWindowsCommandPaths(process.execPath)).resolves.toEqual([
      process.execPath,
      process.execPath,
    ]);
    await expect(resolveAbsoluteWindowsCommandPaths(
      `${process.cwd()}/missing-asciidoctor-pdf.bat`,
    )).resolves.toEqual([
      `${process.cwd()}/missing-asciidoctor-pdf.bat`,
    ]);
  });

  it('returns no Windows command paths for an unknown command', async (): Promise<void> => {
    await expect(findWindowsCommandPaths(
      'adocmd-forge-command-that-does-not-exist',
    )).resolves.toEqual([]);
  });
});
