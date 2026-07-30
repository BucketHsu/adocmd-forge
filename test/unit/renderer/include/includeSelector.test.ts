import {
  mkdtemp,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Reader } from '@asciidoctor/core';

import createAsciidoctorRuntime from '../../../../src/renderer/asciidoctorRuntime.cjs';
import {
  selectIncludeContent,
  type IncludeSelection,
} from '../../../../src/renderer/include';

const FIXTURE_SOURCE = [
  'Preface.',
  '// tag::alpha[]',
  '== Alpha',
  'Alpha content.',
  '// tag::nested[]',
  'Nested content.',
  '// end::nested[]',
  '// end::alpha[]',
  'Between.',
  '// tag::beta[]',
  '== Beta',
  'Beta content.',
  '// end::beta[]',
  'Epilogue.',
].join('\n');

describe('include selector', (): void => {
  it('keeps the original string when no selector is present', (): void => {
    expect(selectIncludeContent('first\r\nsecond\r\n', {})).toEqual({
      data: 'first\r\nsecond\r\n',
      filtered: false,
      firstLine: 1,
      issues: [],
    });
  });

  it('selects sorted line numbers, ranges, and an open range', (): void => {
    expect(selectIncludeContent(
      [
        'one',
        'two',
        'three',
        'four',
        'five',
      ].join('\n'),
      {
        lines: '4,2..3,5..-1',
      },
    )).toEqual({
      data: [
        'two',
        'three',
        'four',
        'five',
      ],
      filtered: true,
      firstLine: 2,
      issues: [],
    });
  });

  it('matches Asciidoctor behavior for empty and non-positive line definitions', (): void => {
    expect(selectIncludeContent('one\ntwo', {
      lines: '3..2',
    })).toMatchObject({
      data: 'one\ntwo',
      filtered: false,
    });
    expect(selectIncludeContent('one\ntwo', {
      lines: '0,2',
    })).toMatchObject({
      data: [],
      filtered: true,
    });
  });

  it('selects tags and reports malformed tag structures', (): void => {
    const selection = selectIncludeContent(
      [
        '// tag::wanted[]',
        'selected',
        '// end::other[]',
        '// tag::open[]',
        'still selected',
      ].join('\n'),
      {
        tags: 'wanted;missing',
      },
    );

    expect(selection.data).toEqual([
      'selected',
      'still selected',
    ]);
    expect(selection.issues).toEqual([
      {
        code: 'mismatched-end-tag',
        expectedTag: 'wanted',
        line: 3,
        tag: 'other',
      },
      {
        code: 'unclosed-tag',
        line: 1,
        tag: 'wanted',
      },
      {
        code: 'missing-tag',
        tag: 'missing',
      },
    ]);
  });

  it('handles exclusion and wildcard tag definitions', (): void => {
    expect(selectIncludeContent(FIXTURE_SOURCE, {
      tags: '**;!nested',
    }).data).toEqual([
      'Preface.',
      '== Alpha',
      'Alpha content.',
      'Between.',
      '== Beta',
      'Beta content.',
      'Epilogue.',
    ]);
  });

  describe('Asciidoctor 3.0.4 parity fixtures', (): void => {
    it.each([
      'lines=3..6',
      'lines=3;4;11..-1',
      'tag=alpha',
      'tags=alpha;beta',
      'tags=**;!nested',
      'tags=*',
      'tags=!*;alpha',
    ])('matches built-in include output for [%s]', async (attributeList): Promise<void> => {
      const temporaryDirectory = await mkdtemp(
        path.join(tmpdir(), 'adocmd-forge-selector-'),
      );
      const fixturePath = path.join(
        temporaryDirectory,
        'fixture.adoc',
      );

      try {
        await writeFile(fixturePath, FIXTURE_SOURCE, 'utf8');
        const nativeOutput = convertNative(
          temporaryDirectory,
          attributeList,
        );
        const customOutput = convertWithSelector(
          temporaryDirectory,
          fixturePath,
          attributeList,
        );

        expect(customOutput).toBe(nativeOutput);
      } finally {
        await rm(temporaryDirectory, {
          force: true,
          recursive: true,
        });
      }
    });
  });
});

function convertNative(
  baseDirectory: string,
  attributeList: string,
): string {
  const asciidoctor = createAsciidoctorRuntime();
  const output = asciidoctor.convert(
    `include::fixture.adoc[${attributeList}]`,
    {
      base_dir: baseDirectory,
      header_footer: false,
      safe: 'safe',
    },
  );
  if (typeof output !== 'string') {
    throw new Error('Expected embedded Asciidoctor output.');
  }
  return output;
}

function convertWithSelector(
  baseDirectory: string,
  fixturePath: string,
  attributeList: string,
): string {
  const asciidoctor = createAsciidoctorRuntime();
  const registry = asciidoctor.Extensions.create();
  registry.includeProcessor(function (): void {
    this.prefer();
    this.handles((target: string): boolean => target === 'fixture.adoc');
    this.process((
      _document,
      reader,
      _target,
      attributes: unknown,
    ): void => {
      const selection = selectIncludeContent(
        FIXTURE_SOURCE,
        asAttributeRecord(attributes),
      );
      pushSelection(reader, selection, fixturePath);
    });
  });

  const output = asciidoctor.convert(
    `include::fixture.adoc[${attributeList}]`,
    {
      base_dir: baseDirectory,
      extension_registry: registry,
      header_footer: false,
      safe: 'secure',
    },
  );
  if (typeof output !== 'string') {
    throw new Error('Expected embedded Asciidoctor output.');
  }
  return output;
}

function pushSelection(
  reader: Reader,
  selection: IncludeSelection,
  fixturePath: string,
): void {
  if (Array.isArray(selection.data) && selection.data.length === 0) {
    return;
  }

  reader.pushInclude(
    selection.data,
    fixturePath,
    'fixture.adoc',
    selection.firstLine,
  );
}

function asAttributeRecord(
  value: unknown,
): Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null
    ? value as Readonly<Record<string, unknown>>
    : {};
}

