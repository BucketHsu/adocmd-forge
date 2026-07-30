import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  createPreviewTitle,
  resolveDocumentKind,
} from '../../../src/preview/previewDocument';

describe('resolveDocumentKind', () => {
  it.each([
    ['asciidoc', 'document.txt', 'asciidoc'],
    ['markdown', 'document.txt', 'markdown'],
    ['plaintext', 'guide.adoc', 'asciidoc'],
    ['plaintext', 'guide.ASCIIDOC', 'asciidoc'],
    ['plaintext', 'guide.md', 'markdown'],
  ] as const)(
    'resolves %s / %s as %s',
    (languageId, fileName, expected) => {
      expect(resolveDocumentKind(languageId, fileName)).toBe(expected);
    },
  );

  it('rejects an unsupported document', () => {
    expect(resolveDocumentKind('plaintext', 'notes.txt')).toBeUndefined();
  });
});

describe('createPreviewTitle', () => {
  it('uses only the document base name', () => {
    expect(createPreviewTitle(path.join('docs', 'guide.adoc'))).toBe(
      'guide.adoc Preview',
    );
  });
});
