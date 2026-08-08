import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

interface PackageManifest {
  readonly activationEvents?: readonly string[];
  readonly categories?: readonly string[];
  readonly contributes?: {
    readonly commands?: readonly {
      readonly command?: string;
    }[];
    readonly configuration?: {
      readonly properties?: Record<string, unknown>;
    };
    readonly menus?: Record<string, unknown>;
    readonly views?: {
      readonly explorer?: readonly {
        readonly id?: string;
        readonly name?: string;
      }[];
    };
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
    expect(manifest.version).toBe('1.2.4');
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
    expect(manifest.engines?.vscode).toBe('^1.97.0');
    expect(manifest.main).toBe('./dist/extension.js');
  });

  it('activates only for supported document languages', async (): Promise<void> => {
    const manifest = await readManifest();

    expect(manifest.activationEvents).toEqual([
      'onLanguage:asciidoc',
      'onLanguage:markdown',
      'onCommand:adocmdForge.openSyntaxGuide',
      'onCommand:adocmdForge.formatBold',
      'onCommand:adocmdForge.formatItalic',
      'onCommand:adocmdForge.formatHighlight',
      'onCommand:adocmdForge.formatCode',
      'onCommand:adocmdForge.formatStrike',
      'onCommand:adocmdForge.formatSuperscript',
      'onCommand:adocmdForge.formatSubscript',
      'onCommand:adocmdForge.copyImage',
      'onCommand:adocmdForge.validateLinks',
      'onView:adocmdForge.outline',
      'onCommand:adocmdForge.refreshOutline',
      'onCommand:adocmdForge.exportHtml',
      'onCommand:adocmdForge.exportStandaloneHtml',
      'onCommand:adocmdForge.exportEmbeddedHtml',
      'onCommand:adocmdForge.exportPdf',
      'onCommand:adocmdForge.previewSource',
      'onCommand:adocmdForge.previewSplit',
      'onCommand:adocmdForge.previewOnly',
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
      'adocmdForge.previewSource',
      'adocmdForge.previewSplit',
      'adocmdForge.previewOnly',
      'adocmdForge.formatBold',
      'adocmdForge.formatItalic',
      'adocmdForge.formatHighlight',
      'adocmdForge.formatCode',
      'adocmdForge.formatStrike',
      'adocmdForge.formatSuperscript',
      'adocmdForge.formatSubscript',
      'adocmdForge.openSyntaxGuide',
      'adocmdForge.copyImage',
      'adocmdForge.refreshOutline',
      'adocmdForge.validateLinks',
      'adocmdForge.exportHtml',
      'adocmdForge.exportStandaloneHtml',
      'adocmdForge.exportEmbeddedHtml',
      'adocmdForge.exportPdf',
    ]);
  });

  it('contributes the Outline view, refresh command and debounce setting', async (): Promise<void> => {
    const manifest = await readManifest();
    expect(manifest.contributes?.views?.explorer).toEqual([
      {
        id: 'adocmdForge.outline',
        name: 'Outline',
      },
    ]);
    expect(manifest.contributes?.menus?.['view/title']).toEqual([
      {
        command: 'adocmdForge.refreshOutline',
        when: 'view == adocmdForge.outline',
        group: 'navigation',
      },
    ]);
    expect(
      manifest.contributes?.configuration?.properties?.['adocmdForge.outline.updateDelay'],
    ).toMatchObject({
      type: 'number',
      default: 150,
    });
    expect(
      manifest.contributes?.configuration?.properties?.['adocmdForge.diagnostics.updateDelay'],
    ).toMatchObject({
      type: 'number',
      default: 150,
    });
    expect(
      manifest.contributes?.configuration?.properties?.['adocmdForge.export.asciidoctorPdfCommand'],
    ).toMatchObject({
      type: 'string',
      default: 'asciidoctor-pdf',
    });
    expect(
      manifest.contributes?.configuration?.properties?.['adocmdForge.export.asciidoctorPdfArguments'],
    ).toMatchObject({
      type: 'array',
      default: [],
    });
  });

  it('exposes formatting beside the source editor and in its selection menu', async (): Promise<void> => {
    const manifest = await readManifest();
    const formattingCommands = [
      'adocmdForge.formatBold',
      'adocmdForge.formatItalic',
      'adocmdForge.formatHighlight',
      'adocmdForge.formatCode',
      'adocmdForge.formatStrike',
      'adocmdForge.formatSuperscript',
      'adocmdForge.formatSubscript',
    ];
    const editorWhen = 'editorLangId == markdown || editorLangId == asciidoc';
    const selectionWhen = (
      'editorHasSelection && '
      + '(editorLangId == markdown || editorLangId == asciidoc)'
    );
    const editorTitle = manifest.contributes?.menus?.['editor/title'] as
      | readonly {
          readonly command?: string;
          readonly when?: string;
        }[]
      | undefined;
    const editorContext = manifest.contributes?.menus?.['editor/context'] as
      | readonly {
          readonly command?: string;
          readonly when?: string;
        }[]
      | undefined;

    expect(editorTitle?.filter(({ command }) => (
      command !== undefined && formattingCommands.includes(command)
    )).map(({ command, when }) => ({ command, when }))).toEqual(
      formattingCommands.map((command) => ({
        command,
        when: editorWhen,
      })),
    );
    expect(editorContext?.filter(({ command }) => (
      command !== undefined && formattingCommands.includes(command)
    )).map(({ command, when }) => ({ command, when }))).toEqual(
      formattingCommands.map((command) => ({
        command,
        when: selectionWhen,
      })),
    );

    expect(editorTitle?.map(({ command }) => command)).toEqual(
      expect.arrayContaining([
        'adocmdForge.openPreview',
        'adocmdForge.refreshPreview',
        'adocmdForge.previewSource',
        'adocmdForge.previewSplit',
        'adocmdForge.previewOnly',
        'adocmdForge.openSyntaxGuide',
        'adocmdForge.validateLinks',
        'adocmdForge.copyImage',
        'adocmdForge.exportHtml',
        'adocmdForge.exportStandaloneHtml',
        'adocmdForge.exportEmbeddedHtml',
        'adocmdForge.exportPdf',
      ]),
    );
  });
});
