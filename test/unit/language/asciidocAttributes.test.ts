import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  createAsciiDocImageReferenceSourcePath,
  readAsciiDocAttribute,
  resolveAsciiDocImageBaseDirectory,
} from '../../../src/language/asciidocAttributes';

describe('AsciiDoc attributes', (): void => {
  it('reads populated and explicitly empty document attributes', (): void => {
    const source = [
      '= Guide',
      ':imagesdir: images/screenshots',
      ':stylesdir:',
    ].join('\n');

    expect(readAsciiDocAttribute(source, 'imagesdir')).toBe('images/screenshots');
    expect(readAsciiDocAttribute(source, 'stylesdir')).toBe('');
    expect(readAsciiDocAttribute(source, 'missing')).toBeUndefined();
  });

  it('uses imagesdir as the image completion base directory', (): void => {
    expect(resolveAsciiDocImageBaseDirectory(
      ':imagesdir: ../images',
      '/workspace/docs/guide.adoc',
    )).toBe(path.resolve('/workspace/images'));
    expect(resolveAsciiDocImageBaseDirectory(
      ':imagesdir:',
      '/workspace/docs/guide.adoc',
    )).toBe(path.resolve('/workspace/docs'));
  });

  it('creates a source path whose directory follows imagesdir', (): void => {
    expect(createAsciiDocImageReferenceSourcePath(
      ':imagesdir: ../images',
      '/workspace/docs/guide.adoc',
    )).toBe(path.resolve('/workspace/images/guide.adoc'));
    expect(createAsciiDocImageReferenceSourcePath(
      ':imagesdir: ..\\images',
      String.raw`D:\workspace\docs\guide.adoc`,
    )).toBe(String.raw`D:\workspace\images\guide.adoc`);
  });

  it('does not resolve dynamic, absolute or remote imagesdir values', (): void => {
    for (const value of [
      '{asset-root}/images',
      '/outside/images',
      String.raw`C:\outside\images`,
      'https://example.com/images',
    ]) {
      expect(resolveAsciiDocImageBaseDirectory(
        `:imagesdir: ${value}`,
        '/workspace/docs/guide.adoc',
      )).toBe(path.resolve('/workspace/docs'));
    }
  });
});
