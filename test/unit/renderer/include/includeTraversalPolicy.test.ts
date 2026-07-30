import path from 'node:path';

import {
  createIncludeTraversalContext,
  enterInclude,
} from '../../../../src/renderer/include';

describe('include traversal policy', (): void => {
  it('creates immutable descendant contexts up to the configured depth', (): void => {
    const root = createIncludeTraversalContext('/docs/guide.adoc');
    const first = enterInclude(root, '/docs/a.adoc', {
      maxDepth: 2,
      pathApi: path.posix,
    });
    expect(first).toEqual({
      context: {
        canonicalAncestors: [
          '/docs/guide.adoc',
          '/docs/a.adoc',
        ],
        depth: 1,
      },
      kind: 'allowed',
    });
    if (first.kind !== 'allowed') {
      throw new Error('Expected first include to be allowed.');
    }

    expect(enterInclude(first.context, '/docs/b.adoc', {
      maxDepth: 2,
      pathApi: path.posix,
    })).toMatchObject({
      context: {
        depth: 2,
      },
      kind: 'allowed',
    });
    expect(root).toEqual({
      canonicalAncestors: [
        '/docs/guide.adoc',
      ],
      depth: 0,
    });
  });

  it('rejects direct and indirect canonical cycles', (): void => {
    const root = createIncludeTraversalContext('/docs/guide.adoc');
    const first = enterInclude(root, '/docs/a.adoc', {
      pathApi: path.posix,
    });
    if (first.kind !== 'allowed') {
      throw new Error('Expected first include to be allowed.');
    }

    expect(enterInclude(first.context, '/docs/guide.adoc', {
      pathApi: path.posix,
    })).toEqual({
      kind: 'rejected',
      reason: 'cycle',
    });
    expect(enterInclude(first.context, '/docs/a.adoc', {
      pathApi: path.posix,
    })).toEqual({
      kind: 'rejected',
      reason: 'cycle',
    });
  });

  it('detects Windows alias cycles case-insensitively', (): void => {
    const root = createIncludeTraversalContext(
      'C:\\Docs\\Guide.adoc',
    );

    expect(enterInclude(root, 'c:\\docs\\GUIDE.adoc', {
      caseSensitive: false,
      pathApi: path.win32,
    })).toEqual({
      kind: 'rejected',
      reason: 'cycle',
    });
  });

  it('rejects the first include when maximum depth is zero', (): void => {
    expect(enterInclude(
      createIncludeTraversalContext(),
      '/docs/a.adoc',
      {
        maxDepth: 0,
        pathApi: path.posix,
      },
    )).toEqual({
      kind: 'rejected',
      reason: 'max-depth',
    });
  });

  it.each([
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
  ])('rejects invalid maximum depth %s', (maxDepth): void => {
    expect(() => enterInclude(
      createIncludeTraversalContext(),
      '/docs/a.adoc',
      {
        maxDepth,
        pathApi: path.posix,
      },
    )).toThrow('Maximum include depth');
  });
});

