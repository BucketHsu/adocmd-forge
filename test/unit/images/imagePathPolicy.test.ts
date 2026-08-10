import { describe, expect, it } from 'vitest';

import {
  getExtension,
  inferImageExtension,
  isPathWithinRoot,
  normalizeImageDirectory,
  resolveDefaultImagePath,
  resolveSelectedImagePath,
  sanitizeImageFileName,
  toPosixRelativePath,
} from '../../../src/images/imagePathPolicy';

describe('image path policy', (): void => {
  it.each([
    ['diagram.png', undefined, '.png'],
    ['diagram.jpeg', 'image/jpeg', '.jpg'],
    ['clipboard', 'image/webp', '.webp'],
    ['icon.svg', 'image/svg+xml; charset=utf-8', '.svg'],
  ])('infers supported image extension for %s', (name, mimeType, expected) => {
    expect(inferImageExtension(name, mimeType)).toBe(expected);
  });

  it.each([
    ['diagram.exe', undefined],
    ['diagram.png', 'image/jpeg'],
    ['diagram', undefined],
    ['diagram.tiff', 'image/tiff'],
  ])('rejects unsupported image source %s', (name, mimeType) => {
    expect(() => inferImageExtension(name, mimeType)).toThrow();
  });

  it('sanitizes path separators, control characters and reserved names', (): void => {
    expect(sanitizeImageFileName('../my\\unsafe name.PNG')).toBe('unsafe-name.png');
    expect(sanitizeImageFileName('CON.png')).toBe('_CON.png');
    expect(sanitizeImageFileName('clipboard', 'image/png')).toBe('clipboard.png');
    expect(sanitizeImageFileName('...png')).toBe('image.png');
  });

  it.each([
    ['images', 'images'],
    ['images\\screenshots', 'images/screenshots'],
    ['./images', 'images'],
  ])('normalizes safe image directory %s', (value, expected) => {
    expect(normalizeImageDirectory(value)).toBe(expected);
  });

  it.each(['', '../images', 'images/../../outside', '/tmp/images', 'C:\\images'])(
    'rejects unsafe image directory %s',
    (directory) => {
      expect(() => normalizeImageDirectory(directory)).toThrow();
    },
  );

  it('resolves a default target beside the current document', (): void => {
    expect(resolveDefaultImagePath(
      '/workspace/docs/guide.adoc',
      '/workspace',
      'images',
      'diagram.png',
    )).toEqual({
      targetPath: '/workspace/docs/images/diagram.png',
      relativePath: 'images/diagram.png',
    });
  });

  it('resolves a selected target and appends a missing extension', (): void => {
    expect(resolveSelectedImagePath(
      '/workspace/docs/guide.md',
      '/workspace',
      '/workspace/assets/diagram',
      '.png',
    )).toEqual({
      targetPath: '/workspace/assets/diagram.png',
      relativePath: '../assets/diagram.png',
    });
  });

  it.each([
    ['/outside/diagram.png', '.png'],
    ['/workspace/assets/diagram.jpg', '.png'],
  ])('rejects an unsafe selected target %s', (selectedPath, extension) => {
    expect(() => resolveSelectedImagePath(
      '/workspace/docs/guide.md',
      '/workspace',
      selectedPath,
      extension,
    )).toThrow();
  });

  it('uses POSIX separators for inserted syntax on Windows-like paths', (): void => {
    expect(toPosixRelativePath(
      'C:\\workspace\\docs\\guide.adoc',
      'C:\\workspace\\docs\\images\\diagram.png',
    )).toBe('images/diagram.png');
    expect(getExtension('diagram.PNG')).toBe('.png');
    expect(isPathWithinRoot('/workspace/docs/file.adoc', '/workspace')).toBe(true);
    expect(isPathWithinRoot('/workspace-private/file.adoc', '/workspace')).toBe(false);
  });
});
