import { describe, expect, it } from 'vitest';

import {
  buildAsciiDocCliArguments,
  runAsciiDocCli,
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
    })).rejects.toThrow('執行失敗');
  });
});
