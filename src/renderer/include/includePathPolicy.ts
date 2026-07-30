import path from 'node:path';

import type { IncludeFileSystem } from './includeFileSystem';

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F]/u;
const URI_SCHEME_PATTERN = /^[a-z][a-z\d+.-]*:/iu;

export interface IncludePathApi {
  readonly sep: string;
  dirname(filePath: string): string;
  isAbsolute(filePath: string): boolean;
  normalize(filePath: string): string;
  relative(from: string, to: string): string;
  resolve(...paths: string[]): string;
}

export interface IncludePathComparisonOptions {
  readonly caseSensitive?: boolean;
  readonly pathApi?: IncludePathApi;
}

export interface CanonicalIncludeRoot {
  readonly canonicalPath: string;
  readonly requestedPath: string;
}

export type IncludeTargetClassification =
  | {
      readonly kind: 'local-relative';
    }
  | {
      readonly kind: 'rejected';
      readonly reason:
        | 'absolute-target'
        | 'external-target'
        | 'invalid-target';
    };

export function classifyIncludeTarget(
  target: string,
  pathApi: IncludePathApi = path,
): IncludeTargetClassification {
  if (
    target.length === 0
    || CONTROL_CHARACTER_PATTERN.test(target)
  ) {
    return {
      kind: 'rejected',
      reason: 'invalid-target',
    };
  }
  if (pathApi.isAbsolute(target) || target.startsWith('//')) {
    return {
      kind: 'rejected',
      reason: 'absolute-target',
    };
  }
  if (URI_SCHEME_PATTERN.test(target)) {
    return {
      kind: 'rejected',
      reason: 'external-target',
    };
  }

  return {
    kind: 'local-relative',
  };
}

export function createCanonicalIncludeRoots(
  rootPaths: readonly string[],
  fileSystem: IncludeFileSystem,
  options: IncludePathComparisonOptions = {},
): CanonicalIncludeRoot[] {
  if (rootPaths.length === 0) {
    throw new Error('At least one include root is required.');
  }

  const pathApi = options.pathApi ?? path;
  const caseSensitive = options.caseSensitive ?? process.platform !== 'win32';
  const roots = new Map<string, CanonicalIncludeRoot>();

  for (const rootPath of rootPaths) {
    const requestedPath = pathApi.resolve(rootPath);
    const canonicalPath = pathApi.resolve(fileSystem.realpath(requestedPath));
    if (!fileSystem.stat(canonicalPath).isDirectory) {
      throw new Error(`Include root is not a directory: ${requestedPath}`);
    }

    const root: CanonicalIncludeRoot = {
      canonicalPath,
      requestedPath,
    };
    roots.set(
      `${createPathKey(requestedPath, pathApi, caseSensitive)}\u0000`
      + createPathKey(canonicalPath, pathApi, caseSensitive),
      root,
    );
  }

  return [...roots.values()];
}

export function isPathWithinRoot(
  candidatePath: string,
  rootPath: string,
  options: IncludePathComparisonOptions = {},
): boolean {
  const pathApi = options.pathApi ?? path;
  const caseSensitive = options.caseSensitive ?? process.platform !== 'win32';
  const comparableCandidate = createPathKey(
    candidatePath,
    pathApi,
    caseSensitive,
  );
  const comparableRoot = createPathKey(rootPath, pathApi, caseSensitive);
  const relativePath = pathApi.relative(
    comparableRoot,
    comparableCandidate,
  );

  return relativePath === ''
    || (
      relativePath !== '..'
      && !relativePath.startsWith(`..${pathApi.sep}`)
      && !pathApi.isAbsolute(relativePath)
    );
}

export function createPathKey(
  filePath: string,
  pathApi: IncludePathApi = path,
  caseSensitive: boolean = process.platform !== 'win32',
): string {
  const normalizedPath = pathApi.normalize(pathApi.resolve(filePath));
  return caseSensitive
    ? normalizedPath
    : normalizedPath.toLowerCase();
}

