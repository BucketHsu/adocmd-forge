import path from 'node:path';

import {
  classifyIncludeTarget,
  createCanonicalIncludeRoots,
  isPathWithinRoot,
} from '../../../../src/renderer/include';
import { FakeIncludeFileSystem } from './fakeIncludeFileSystem';

describe('include path policy', (): void => {
  it.each([
    'https://example.com/chapter.adoc',
    'file:///secret.adoc',
    'C:drive-relative.adoc',
  ])('rejects URI-like target %s', (target): void => {
    expect(classifyIncludeTarget(target, path.win32)).toEqual({
      kind: 'rejected',
      reason: 'external-target',
    });
  });

  it.each([
    'C:\\secret.adoc',
    '\\\\server\\share\\secret.adoc',
    '//server/share/secret.adoc',
  ])('rejects absolute Windows target %s', (target): void => {
    expect(classifyIncludeTarget(target, path.win32)).toEqual({
      kind: 'rejected',
      reason: 'absolute-target',
    });
  });

  it.each([
    '',
    'chapter\u0000.adoc',
    'chapter\n.adoc',
  ])('rejects invalid target %j', (target): void => {
    expect(classifyIncludeTarget(target, path.posix)).toEqual({
      kind: 'rejected',
      reason: 'invalid-target',
    });
  });

  it('accepts a local relative target without rewriting it', (): void => {
    expect(classifyIncludeTarget(
      '../shared/chapter.adoc',
      path.posix,
    )).toEqual({
      kind: 'local-relative',
    });
  });

  it('checks POSIX path boundaries by complete path segment', (): void => {
    expect(isPathWithinRoot(
      '/workspace/docs/chapter.adoc',
      '/workspace/docs',
      {
        caseSensitive: true,
        pathApi: path.posix,
      },
    )).toBe(true);
    expect(isPathWithinRoot(
      '/workspace/docs-other/chapter.adoc',
      '/workspace/docs',
      {
        caseSensitive: true,
        pathApi: path.posix,
      },
    )).toBe(false);
  });

  it('checks Windows paths case-insensitively when configured', (): void => {
    expect(isPathWithinRoot(
      'c:\\WORKSPACE\\Docs\\chapter.adoc',
      'C:\\workspace\\docs',
      {
        caseSensitive: false,
        pathApi: path.win32,
      },
    )).toBe(true);
    expect(isPathWithinRoot(
      'C:\\workspace\\docs-old\\chapter.adoc',
      'C:\\workspace\\docs',
      {
        caseSensitive: false,
        pathApi: path.win32,
      },
    )).toBe(false);
  });

  it('canonicalizes and deduplicates configured roots', (): void => {
    const fileSystem = new FakeIncludeFileSystem(path.posix, true);
    fileSystem.addDirectory('/mount/docs', '/real/docs');

    expect(createCanonicalIncludeRoots(
      [
        '/mount/docs',
        '/mount/docs/.',
      ],
      fileSystem,
      {
        caseSensitive: true,
        pathApi: path.posix,
      },
    )).toEqual([
      {
        canonicalPath: '/real/docs',
        requestedPath: '/mount/docs',
      },
    ]);
  });

  it('rejects an empty root set and roots that are not directories', (): void => {
    const fileSystem = new FakeIncludeFileSystem(path.posix, true);
    fileSystem.addFile('/workspace/not-a-directory', 'content');

    expect(() => createCanonicalIncludeRoots(
      [],
      fileSystem,
      {
        pathApi: path.posix,
      },
    )).toThrow('At least one include root is required.');
    expect(() => createCanonicalIncludeRoots(
      [
        '/workspace/not-a-directory',
      ],
      fileSystem,
      {
        pathApi: path.posix,
      },
    )).toThrow('Include root is not a directory');
  });
});

