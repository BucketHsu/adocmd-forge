import { describe, expect, it } from 'vitest';

import {
  createReferenceFragmentRange,
  WorkspaceDocumentIndex,
} from '../../../src/language/workspaceDocumentIndex';

describe('WorkspaceDocumentIndex', (): void => {
  it('indexes explicit and generated anchors across documents', (): void => {
    const index = createIndex();

    expect(index.findAnchor('/workspace/guide.adoc', 'intro')).toMatchObject({
      definition: {
        id: 'intro',
        explicit: true,
      },
    });
    expect(index.findAnchor('/workspace/chapter.adoc', 'chapter_title')).toMatchObject({
      definition: {
        id: 'chapter_title',
        explicit: false,
        title: 'Chapter Title',
      },
    });
  });

  it('resolves definitions and finds references to the same anchor', (): void => {
    const index = createIndex();
    const guide = index.getDocument('file:///workspace/guide.adoc');
    if (guide === undefined) {
      throw new Error('Expected indexed guide.');
    }
    const reference = guide.analysis.references[0];
    if (reference === undefined) {
      throw new Error('Expected indexed xref.');
    }

    expect(index.resolveReference(guide.documentUri, reference)).toMatchObject({
      path: '/workspace/chapter.adoc',
      fragment: 'details',
      definition: {
        id: 'details',
        explicit: true,
      },
    });
    expect(index.findReferences('/workspace/chapter.adoc', 'details')).toHaveLength(2);
  });

  it('resolves standard shorthand xrefs as internal anchors', (): void => {
    const index = createIndex();
    const guide = index.getDocument('file:///workspace/guide.adoc');
    if (guide === undefined) {
      throw new Error('Expected indexed guide.');
    }
    const reference = guide.analysis.references.find(({ target }) => target === '#intro');
    if (reference === undefined) {
      throw new Error('Expected shorthand xref.');
    }

    expect(index.resolveReference(guide.documentUri, reference)).toMatchObject({
      path: '/workspace/guide.adoc',
      fragment: 'intro',
      definition: {
        id: 'intro',
      },
    });
    expect(createReferenceFragmentRange(reference)).toEqual(reference.range);
  });

  it('returns only explicit anchors as safe rename definitions', (): void => {
    const index = createIndex();

    expect(index.findTargetAt('file:///workspace/chapter.adoc', {
      line: 0,
      character: 3,
    })).toMatchObject({
      definition: {
        explicit: false,
        id: 'chapter_title',
      },
    });
    expect(index.findTargetAt('file:///workspace/chapter.adoc', {
      line: 2,
      character: 3,
    })).toMatchObject({
      definition: {
        explicit: true,
        id: 'details',
      },
    });
  });

  it('resolves image references from the declared imagesdir', (): void => {
    const index = new WorkspaceDocumentIndex(['/workspace']);
    const document = index.upsert({
      documentUri: 'file:///workspace/docs/guide.adoc',
      filePath: '/workspace/docs/guide.adoc',
      kind: 'asciidoc',
      source: ':imagesdir: ../images\n\nimage::logo.png[]',
      version: 1,
    });
    const reference = document.analysis.references[0];
    if (reference === undefined) {
      throw new Error('Expected indexed image reference.');
    }

    expect(index.resolveReference(document.documentUri, reference)).toMatchObject({
      path: '/workspace/images/logo.png',
    });
  });
});

function createIndex(): WorkspaceDocumentIndex {
  const index = new WorkspaceDocumentIndex(['/workspace']);
  index.upsert({
    documentUri: 'file:///workspace/guide.adoc',
    filePath: '/workspace/guide.adoc',
    kind: 'asciidoc',
    source: [
      '= Guide',
      '[[intro]]',
      'xref:chapter.adoc#details[Details]',
      '<<intro>>',
    ].join('\n'),
    version: 1,
  });
  index.upsert({
    documentUri: 'file:///workspace/chapter.adoc',
    filePath: '/workspace/chapter.adoc',
    kind: 'asciidoc',
    source: [
      '= Chapter Title',
      '',
      '[[details]]',
      '== Details',
      'xref:#details[Self]',
      'xref:guide.adoc#intro[Back]',
    ].join('\n'),
    version: 1,
  });
  return index;
}
