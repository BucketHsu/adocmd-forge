import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

interface PackageManifest {
  readonly activationEvents?: readonly string[];
  readonly categories?: readonly string[];
  readonly contributes?: {
    readonly commands?: readonly {
      readonly command?: string;
      readonly icon?: string;
      readonly title?: string;
    }[];
    readonly configuration?: {
      readonly properties?: Record<string, unknown>;
    };
    readonly grammars?: readonly {
      readonly language?: string;
      readonly path?: string;
      readonly scopeName?: string;
    }[];
    readonly keybindings?: readonly {
      readonly command?: string;
      readonly key?: string;
      readonly mac?: string;
      readonly when?: string;
    }[];
    readonly languages?: readonly {
      readonly configuration?: string;
      readonly extensions?: readonly string[];
      readonly id?: string;
    }[];
    readonly menus?: Record<string, unknown>;
    readonly snippets?: readonly {
      readonly language?: string;
      readonly path?: string;
    }[];
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
  readonly galleryBanner?: {
    readonly color?: string;
    readonly theme?: string;
  };
  readonly keywords?: readonly string[];
  readonly main?: string;
  readonly name?: string;
  readonly publisher?: string;
  readonly pricing?: string;
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
    expect(manifest.version).toBe('1.4.0');
    expect(manifest.description).toBe(
      'Professional AsciiDoc and Markdown workspace with live preview, '
      + 'syntax assistance, link diagnostics, image workflows, and '
      + 'HTML/PDF export.',
    );
    expect(manifest.categories).toEqual([
      'Programming Languages',
      'Visualization',
      'Formatters',
    ]);
    expect(manifest.keywords).toEqual([
      'asciidoc',
      'asciidoctor',
      'markdown',
      'preview',
      'documentation',
      'docs',
      'html',
      'pdf',
      'link checker',
    ]);
    expect(manifest.galleryBanner).toEqual({
      color: '#073B78',
      theme: 'dark',
    });
    expect(manifest.pricing).toBe('Free');
    expect(manifest.engines?.vscode).toBe('^1.97.0');
    expect(manifest.main).toBe('./dist/extension.js');
  });

  it('activates only for supported document languages', async (): Promise<void> => {
    const manifest = await readManifest();

    expect(manifest.activationEvents).toEqual([
      'onLanguage:asciidoc',
      'onLanguage:markdown',
      'onCommand:adocmdForge.openSyntaxGuide',
      'onCommand:adocmdForge.showFormattingPalette',
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
      'adocmdForge.showFormattingPalette',
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

  it('exposes a floating formatting palette and selection context actions', async (): Promise<void> => {
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
    const selectionWhen = (
      'editorHasSelection && '
      + '(editorLangId == markdown || editorLangId == asciidoc)'
    );
    const editorTitle = manifest.contributes?.menus?.['editor/title'] as
      | readonly {
          readonly command?: string;
          readonly group?: string;
          readonly when?: string;
        }[]
      | undefined;
    const editorContext = manifest.contributes?.menus?.['editor/context'] as
      | readonly {
          readonly command?: string;
          readonly group?: string;
          readonly when?: string;
        }[]
      | undefined;

    expect(editorTitle?.filter(({ command }) => (
      command !== undefined && formattingCommands.includes(command)
    ))).toEqual([]);
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
    expect(editorContext).toContainEqual({
      command: 'adocmdForge.showFormattingPalette',
      group: '2_modification@0',
      when: 'editorLangId == markdown || editorLangId == asciidoc',
    });
  });

  it('contributes AsciiDoc grammar, snippets and editor-only keybindings', async (): Promise<void> => {
    const manifest = await readManifest();

    expect(manifest.contributes?.languages).toContainEqual(expect.objectContaining({
      configuration: './language-configuration.json',
      extensions: ['.adoc', '.asciidoc'],
      id: 'asciidoc',
    }));
    expect(manifest.contributes?.grammars).toEqual([{
      language: 'asciidoc',
      path: './syntaxes/asciidoc.tmLanguage.json',
      scopeName: 'text.asciidoc',
    }]);
    expect(manifest.contributes?.snippets).toEqual([{
      language: 'asciidoc',
      path: './snippets/asciidoc.json',
    }]);
    expect(manifest.contributes?.keybindings).toEqual([
      {
        command: 'adocmdForge.formatBold',
        key: 'ctrl+b',
        mac: 'cmd+b',
        when: 'editorTextFocus && editorLangId == asciidoc',
      },
      {
        command: 'adocmdForge.formatItalic',
        key: 'ctrl+i',
        mac: 'cmd+i',
        when: 'editorTextFocus && editorLangId == asciidoc',
      },
      {
        command: 'adocmdForge.formatCode',
        key: 'ctrl+alt+c',
        mac: 'cmd+alt+c',
        when: 'editorTextFocus && editorLangId == asciidoc',
      },
      {
        command: 'adocmdForge.showFormattingPalette',
        key: 'ctrl+shift+.',
        mac: 'cmd+shift+.',
        when: 'editorTextFocus && editorLangId == asciidoc',
      },
    ]);
  });

  it('uses icons with text tooltips for every title-bar action', async (): Promise<void> => {
    const manifest = await readManifest();
    const commands = new Map(
      manifest.contributes?.commands?.map((command) => [
        command.command,
        command,
      ]),
    );
    const titleBarMenus = [
      ...(manifest.contributes?.menus?.['editor/title'] as readonly {
        readonly command?: string;
      }[] | undefined ?? []),
      ...(manifest.contributes?.menus?.['view/title'] as readonly {
        readonly command?: string;
      }[] | undefined ?? []),
    ];

    for (const menu of titleBarMenus) {
      const command = commands.get(menu.command);
      expect(command?.icon, menu.command).toMatch(/^\$\([a-z-]+\)$/u);
      expect(command?.title, menu.command).toBeTypeOf('string');
      expect(command?.title, menu.command).toMatch(/\S/u);
    }
  });
});
