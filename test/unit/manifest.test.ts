import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

interface PackageManifest {
  readonly activationEvents?: readonly string[];
  readonly categories?: readonly string[];
  readonly contributes?: {
    readonly commands?: readonly {
      readonly command?: string;
    }[];
  };
  readonly description?: string;
  readonly displayName?: string;
  readonly engines?: {
    readonly vscode?: string;
  };
  readonly keywords?: readonly string[];
  readonly main?: string;
  readonly name?: string;
  readonly publisher?: string;
  readonly version?: string;
}

async function readManifest(): Promise<PackageManifest> {
  const manifestUrl = new URL('../../package.json', import.meta.url);
  return JSON.parse(await readFile(manifestUrl, 'utf8')) as PackageManifest;
}

describe('extension manifest', (): void => {
  it('declares stable identity and compatibility metadata', async (): Promise<void> => {
    const manifest = await readManifest();

    expect(manifest.name).toBe('adocmd-forge');
    expect(manifest.displayName).toBe('AdocMD Forge');
    expect(manifest.publisher).toBe('BucketHsu');
    expect(manifest.version).toBe('0.0.1');
    expect(manifest.description).toBe(
      'Secure live preview for AsciiDoc and Markdown with synchronized '
      + 'scrolling and VS Code theme support.',
    );
    expect(manifest.categories).toEqual([
      'Other',
      'Visualization',
    ]);
    expect(manifest.keywords).toEqual([
      'asciidoc',
      'markdown',
      'preview',
      'documentation',
    ]);
    expect(manifest.engines?.vscode).toBe('^1.96.0');
    expect(manifest.main).toBe('./dist/extension.js');
  });

  it('activates only for supported document languages', async (): Promise<void> => {
    const manifest = await readManifest();

    expect(manifest.activationEvents).toEqual([
      'onLanguage:asciidoc',
      'onLanguage:markdown',
    ]);
  });

  it('contributes every implemented preview command', async (): Promise<void> => {
    const manifest = await readManifest();
    const commandIdentifiers = manifest.contributes?.commands?.map(
      ({ command }) => command,
    );

    expect(commandIdentifiers).toEqual([
      'adocmdForge.openPreview',
      'adocmdForge.refreshPreview',
    ]);
  });
});
