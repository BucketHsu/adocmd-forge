import {
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  SecureIncludeResolver,
  type IncludePathApi,
  type LocalIncludeSnapshot,
} from '../../../../src/renderer/include';
import { FakeIncludeFileSystem } from './fakeIncludeFileSystem';

interface ResolverFixture {
  readonly fileSystem: FakeIncludeFileSystem;
  readonly includingFilePath: string;
  readonly pathApi: IncludePathApi;
  readonly rootPath: string;
}

function createPosixFixture(): ResolverFixture {
  const pathApi = path.posix;
  const fileSystem = new FakeIncludeFileSystem(pathApi, true);
  const rootPath = '/workspace/docs';
  fileSystem.addDirectory(rootPath);
  fileSystem.addFile(
    '/workspace/docs/chapter.adoc',
    'Content from disk.',
  );

  return {
    fileSystem,
    includingFilePath: '/workspace/docs/guide.adoc',
    pathApi,
    rootPath,
  };
}

function createResolver(
  fixture: ResolverFixture,
  snapshot: Partial<LocalIncludeSnapshot> = {},
): SecureIncludeResolver {
  return new SecureIncludeResolver(
    {
      allowedRootPaths: snapshot.allowedRootPaths ?? [
        fixture.rootPath,
      ],
      openDocuments: snapshot.openDocuments ?? [],
    },
    {
      caseSensitive: fixture.pathApi === path.win32
        ? false
        : true,
      fileSystem: fixture.fileSystem,
      pathApi: fixture.pathApi,
    },
  );
}

describe('secure include resolver', (): void => {
  it('loads an allowed relative file and reports both dependency paths', (): void => {
    const fixture = createPosixFixture();
    const result = createResolver(fixture).resolve({
      includingFilePath: fixture.includingFilePath,
      target: 'chapter.adoc',
    });

    expect(result).toEqual({
      content: 'Content from disk.',
      dependency: {
        canonicalPath: '/workspace/docs/chapter.adoc',
        requestedPath: '/workspace/docs/chapter.adoc',
        state: 'loaded',
      },
      kind: 'loaded',
      source: 'file-system',
    });
  });

  it('prefers the newest canonical open-document snapshot over disk', (): void => {
    const fixture = createPosixFixture();
    fixture.fileSystem.addAlias(
      '/workspace/docs/chapter-alias.adoc',
      '/workspace/docs/chapter.adoc',
    );
    const resolver = createResolver(fixture, {
      openDocuments: [
        {
          path: '/workspace/docs/chapter-alias.adoc',
          text: 'Older editor content.',
          version: 3,
        },
        {
          path: '/workspace/docs/chapter.adoc',
          text: 'Unsaved editor content.',
          version: 4,
        },
      ],
    });

    expect(resolver.resolve({
      includingFilePath: fixture.includingFilePath,
      target: 'chapter.adoc',
    })).toEqual({
      content: 'Unsaved editor content.',
      dependency: {
        canonicalPath: '/workspace/docs/chapter.adoc',
        requestedPath: '/workspace/docs/chapter.adoc',
        state: 'loaded',
      },
      kind: 'loaded',
      snapshotVersion: 4,
      source: 'open-document',
    });
    expect(fixture.fileSystem.readCount).toBe(0);
  });

  it('does not index an open document outside the lexical root', (): void => {
    const fixture = createPosixFixture();
    fixture.fileSystem.addFile(
      '/outside/chapter.adoc',
      'Outside content.',
      '/workspace/docs/chapter.adoc',
    );
    const resolver = createResolver(fixture, {
      openDocuments: [
        {
          path: '/outside/chapter.adoc',
          text: 'Untrusted editor content.',
          version: 10,
        },
      ],
    });

    expect(resolver.resolve({
      includingFilePath: fixture.includingFilePath,
      target: 'chapter.adoc',
    })).toMatchObject({
      content: 'Content from disk.',
      kind: 'loaded',
      source: 'file-system',
    });
  });

  it.each([
    false,
    true,
  ])('reports missing include with optional=%s', (optional): void => {
    const fixture = createPosixFixture();

    expect(createResolver(fixture).resolve({
      includingFilePath: fixture.includingFilePath,
      optional,
      target: 'missing.adoc',
    })).toEqual({
      dependency: {
        requestedPath: '/workspace/docs/missing.adoc',
        state: 'missing',
      },
      kind: 'missing',
      optional,
    });
  });

  it('rejects lexical traversal even when the outside file exists', (): void => {
    const fixture = createPosixFixture();
    fixture.fileSystem.addFile(
      '/workspace/secret.adoc',
      'Secret.',
    );

    expect(createResolver(fixture).resolve({
      includingFilePath: fixture.includingFilePath,
      optional: true,
      target: '../secret.adoc',
    })).toEqual({
      kind: 'rejected',
      reason: 'outside-root',
      target: '../secret.adoc',
    });
  });

  it('rejects a symbolic-link target whose canonical path escapes the root', (): void => {
    const fixture = createPosixFixture();
    fixture.fileSystem.addFile('/outside/secret.adoc', 'Secret.');
    fixture.fileSystem.addAlias(
      '/workspace/docs/link.adoc',
      '/outside/secret.adoc',
    );

    expect(createResolver(fixture).resolve({
      includingFilePath: fixture.includingFilePath,
      target: 'link.adoc',
    })).toEqual({
      kind: 'rejected',
      reason: 'outside-root',
      target: 'link.adoc',
    });
    expect(fixture.fileSystem.readCount).toBe(0);
  });

  it('allows a symbolic-link target that resolves inside the canonical root', (): void => {
    const fixture = createPosixFixture();
    fixture.fileSystem.addAlias(
      '/workspace/docs/link.adoc',
      '/workspace/docs/chapter.adoc',
    );

    expect(createResolver(fixture).resolve({
      includingFilePath: fixture.includingFilePath,
      target: 'link.adoc',
    })).toMatchObject({
      content: 'Content from disk.',
      dependency: {
        canonicalPath: '/workspace/docs/chapter.adoc',
        requestedPath: '/workspace/docs/link.adoc',
      },
      kind: 'loaded',
    });
  });

  it('supports a canonical root behind a mount or junction path', (): void => {
    const pathApi = path.win32;
    const fileSystem = new FakeIncludeFileSystem(pathApi, false);
    fileSystem.addDirectory(
      'C:\\mount\\docs',
      'D:\\real\\docs',
    );
    fileSystem.addFile(
      'C:\\mount\\docs\\chapter.adoc',
      'Remote-compatible content.',
      'D:\\real\\docs\\chapter.adoc',
    );
    const fixture: ResolverFixture = {
      fileSystem,
      includingFilePath: 'c:\\MOUNT\\docs\\guide.adoc',
      pathApi,
      rootPath: 'C:\\mount\\docs',
    };

    expect(createResolver(fixture).resolve({
      includingFilePath: fixture.includingFilePath,
      target: 'chapter.adoc',
    })).toMatchObject({
      content: 'Remote-compatible content.',
      dependency: {
        canonicalPath: 'D:\\real\\docs\\chapter.adoc',
      },
      kind: 'loaded',
    });
  });

  it.each([
    {
      reason: 'external-target',
      target: 'https://example.com/chapter.adoc',
    },
    {
      reason: 'absolute-target',
      target: '/etc/passwd',
    },
    {
      reason: 'invalid-target',
      target: 'bad\u0000name.adoc',
    },
  ] as const)('rejects $reason targets before filesystem access', ({
    reason,
    target,
  }): void => {
    const fixture = createPosixFixture();

    expect(createResolver(fixture).resolve({
      includingFilePath: fixture.includingFilePath,
      target,
    })).toEqual({
      kind: 'rejected',
      reason,
      target,
    });
    expect(fixture.fileSystem.readCount).toBe(0);
  });

  it('distinguishes non-files and unreadable targets', (): void => {
    const fixture = createPosixFixture();
    fixture.fileSystem.addOther('/workspace/docs/socket');
    fixture.fileSystem.rejectRealpath(
      '/workspace/docs/private.adoc',
      'EACCES',
    );
    const resolver = createResolver(fixture);

    expect(resolver.resolve({
      includingFilePath: fixture.includingFilePath,
      target: 'socket',
    })).toEqual({
      kind: 'rejected',
      reason: 'not-file',
      target: 'socket',
    });
    expect(resolver.resolve({
      includingFilePath: fixture.includingFilePath,
      target: 'private.adoc',
    })).toEqual({
      kind: 'rejected',
      reason: 'unreadable',
      target: 'private.adoc',
    });
  });

  it('rejects a real directory link or Windows junction that escapes the root', async (): Promise<void> => {
    const temporaryDirectory = await mkdtemp(
      path.join(tmpdir(), 'adocmd-forge-include-'),
    );
    const rootPath = path.join(temporaryDirectory, 'root');
    const outsidePath = path.join(temporaryDirectory, 'outside');

    try {
      await mkdir(rootPath);
      await mkdir(outsidePath);
      await writeFile(
        path.join(outsidePath, 'secret.adoc'),
        'Secret.',
        'utf8',
      );
      await symlink(
        outsidePath,
        path.join(rootPath, 'escape'),
        process.platform === 'win32' ? 'junction' : 'dir',
      );

      const resolver = new SecureIncludeResolver({
        allowedRootPaths: [
          rootPath,
        ],
        openDocuments: [],
      });
      expect(resolver.resolve({
        includingFilePath: path.join(rootPath, 'guide.adoc'),
        target: 'escape/secret.adoc',
      })).toEqual({
        kind: 'rejected',
        reason: 'outside-root',
        target: 'escape/secret.adoc',
      });
    } finally {
      await rm(temporaryDirectory, {
        force: true,
        recursive: true,
      });
    }
  });
});

