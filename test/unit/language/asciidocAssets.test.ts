import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

interface TextMateGrammar {
  readonly name?: string;
  readonly patterns?: readonly { readonly include?: string }[];
  readonly repository?: Record<string, unknown>;
  readonly scopeName?: string;
}

interface SnippetDefinition {
  readonly body?: string | readonly string[];
  readonly description?: string;
  readonly prefix?: string | readonly string[];
}

describe('AsciiDoc declarative language assets', (): void => {
  it('ships a TextMate grammar for core AsciiDoc structures', async (): Promise<void> => {
    const source = await readProjectFile('syntaxes/asciidoc.tmLanguage.json');
    const grammar = JSON.parse(source) as TextMateGrammar;

    expect(grammar).toMatchObject({
      name: 'AsciiDoc',
      scopeName: 'text.asciidoc',
    });
    expect(grammar.patterns?.map(({ include }) => include)).toEqual([
      '#comments',
      '#literalBlocks',
      '#headings',
      '#attributes',
      '#blockMetadata',
      '#delimiters',
      '#lists',
      '#admonitions',
      '#macros',
      '#inline',
    ]);
    expect(Object.keys(grammar.repository ?? {})).toEqual(expect.arrayContaining([
      'admonitions',
      'attributes',
      'blockMetadata',
      'comments',
      'headings',
      'inline',
      'lists',
      'literalBlocks',
      'macros',
    ]));
    expect(source).toContain('markup.strikethrough.asciidoc');
    expect(source).toContain('markup.subscript.asciidoc');
    expect(source).not.toMatch(/TODO|FIXME/u);
  });

  it('ships unique, documented snippets for common authoring blocks', async (): Promise<void> => {
    const source = await readProjectFile('snippets/asciidoc.json');
    const snippets = JSON.parse(source) as Record<string, SnippetDefinition>;
    const prefixes = Object.values(snippets).flatMap(({ prefix }) => (
      typeof prefix === 'string' ? [prefix] : prefix ?? []
    ));

    expect(Object.keys(snippets).length).toBeGreaterThanOrEqual(20);
    expect(new Set(prefixes).size).toBe(prefixes.length);
    expect(prefixes).toEqual(expect.arrayContaining([
      'adoc-header',
      'admonition-block',
      'anchor',
      'image',
      'include',
      'source',
      'table',
      'xref',
    ]));
    for (const snippet of Object.values(snippets)) {
      expect(snippet.description?.trim().length).toBeGreaterThan(0);
      expect(snippet.body).toBeDefined();
    }
    expect(source).not.toMatch(/TODO|FIXME/u);
  });
});

async function readProjectFile(relativePath: string): Promise<string> {
  return readFile(new URL(`../../../${relativePath}`, import.meta.url), 'utf8');
}
