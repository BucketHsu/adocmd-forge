import { describe, expect, it } from 'vitest';

import {
  getAsciiDocCompletionSuggestions,
} from '../../../src/language/asciidocCompletion';

describe('AsciiDoc completion core', (): void => {
  it('suggests structural syntax on a blank AsciiDoc line', (): void => {
    const suggestions = getAsciiDocCompletionSuggestions({
      languageId: 'asciidoc',
      lineText: '  ',
      character: 2,
    });
    const ids = suggestions.map(({ entry }) => entry.id);

    expect(ids).toContain('heading');
    expect(ids).toContain('sourceBlock');
    expect(ids).toContain('image');
    expect(ids).toContain('include');
    expect(ids).not.toContain('bold');
    expect(suggestions[0]?.replacementStart).toBe(2);
    expect(suggestions[0]?.replacementEnd).toBe(2);
  });

  it('replaces only the heading marker typed before the cursor', (): void => {
    const suggestions = getAsciiDocCompletionSuggestions({
      languageId: 'asciidoc',
      lineText: '  == ',
      character: 5,
    });
    const heading = suggestions.find(({ entry }) => entry.id === 'heading');

    expect(heading).toMatchObject({
      replacementStart: 2,
      replacementEnd: 5,
    });
  });

  it('offers inline emphasis after an inline marker', (): void => {
    const suggestions = getAsciiDocCompletionSuggestions({
      languageId: 'asciidoc',
      lineText: '文字 *',
      character: 4,
    });

    expect(suggestions.map(({ entry }) => entry.id)).toEqual([
      'bold',
      'italic',
      'monospace',
    ]);
    expect(suggestions[0]?.replacementStart).toBe(3);
    expect(suggestions[0]?.replacementEnd).toBe(4);
  });

  it('narrows suggestions to the typed macro family', (): void => {
    const suggestions = getAsciiDocCompletionSuggestions({
      languageId: 'asciidoc',
      lineText: 'include::docs/',
      character: 14,
    });

    expect(suggestions.map(({ entry }) => entry.id)).toEqual(['include']);
    expect(suggestions[0]?.replacementStart).toBe(0);
  });

  it('does not add unrelated suggestions to prose', (): void => {
    const suggestions = getAsciiDocCompletionSuggestions({
      languageId: 'asciidoc',
      lineText: '這是一段一般文字',
      character: 8,
    });

    expect(suggestions).toEqual([]);
  });

  it('does not operate on Markdown documents', (): void => {
    const suggestions = getAsciiDocCompletionSuggestions({
      languageId: 'markdown',
      lineText: '',
      character: 0,
    });

    expect(suggestions).toEqual([]);
  });
});
