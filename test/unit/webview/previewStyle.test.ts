import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

describe('preview stylesheet', (): void => {
  it('uses VS Code theme tokens for light, dark, and high-contrast modes', async (): Promise<void> => {
    const stylesheet = await readPreviewStylesheet();

    expect(stylesheet).toContain('var(--vscode-editor-background)');
    expect(stylesheet).toContain('body.vscode-light');
    expect(stylesheet).toContain('body.vscode-dark');
    expect(stylesheet).toContain('body.vscode-high-contrast');
    expect(stylesheet).toContain('body.vscode-high-contrast-light');
  });

  it('overrides editor theme colors with a readable print palette', async (): Promise<void> => {
    const stylesheet = await readPreviewStylesheet();
    const printRules = stylesheet.slice(stylesheet.indexOf('@media print'));

    expect(printRules).toContain('--preview-code-background: #f3f3f3');
    expect(printRules).toContain('color: #000');
    expect(printRules).toContain('background: #fff');
  });

  it('keeps preview padding outside document-controlled body styles', async (): Promise<void> => {
    const stylesheet = await readPreviewStylesheet();

    expect(stylesheet).toContain('#preview-viewport');
    expect(stylesheet).toMatch(
      /#preview-viewport\s*\{[^}]*padding:\s*clamp\(1rem, 3vw, 2\.5rem\)/u,
    );
  });

  it('visibly marks the source block selected in the editor', async (): Promise<void> => {
    const stylesheet = await readPreviewStylesheet();

    expect(stylesheet).toContain('.adocmd-forge-current-source');
    expect(stylesheet).toContain('var(--vscode-editorCursor-foreground)');
    const currentSourceRule = /\.adocmd-forge-current-source\s*\{([^}]*)\}/u.exec(
      stylesheet,
    )?.[1] ?? '';
    expect(currentSourceRule).not.toContain('background:');
    expect(currentSourceRule).toContain('outline: 1px solid');
  });
});

async function readPreviewStylesheet(): Promise<string> {
  const stylesheetUrl = new URL('../../../media/preview.css', import.meta.url);
  return readFile(stylesheetUrl, 'utf8');
}
