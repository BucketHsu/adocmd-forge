import path from 'node:path';

import {
  createPathKey,
  type IncludePathComparisonOptions,
} from './includePathPolicy';

export const DEFAULT_MAX_INCLUDE_DEPTH = 64;

export interface IncludeTraversalContext {
  readonly canonicalAncestors: readonly string[];
  readonly depth: number;
}

export interface AllowedIncludeTraversal {
  readonly context: IncludeTraversalContext;
  readonly kind: 'allowed';
}

export interface RejectedIncludeTraversal {
  readonly kind: 'rejected';
  readonly reason: 'cycle' | 'max-depth';
}

export type IncludeTraversalResult =
  | AllowedIncludeTraversal
  | RejectedIncludeTraversal;

export interface IncludeTraversalPolicyOptions
  extends IncludePathComparisonOptions {
  readonly maxDepth?: number;
}

export function createIncludeTraversalContext(
  canonicalSourcePath?: string,
): IncludeTraversalContext {
  return {
    canonicalAncestors: canonicalSourcePath === undefined
      ? []
      : [
          canonicalSourcePath,
        ],
    depth: 0,
  };
}

export function enterInclude(
  context: IncludeTraversalContext,
  canonicalTargetPath: string,
  options: IncludeTraversalPolicyOptions = {},
): IncludeTraversalResult {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_INCLUDE_DEPTH;
  if (!Number.isSafeInteger(maxDepth) || maxDepth < 0) {
    throw new Error('Maximum include depth must be a non-negative integer.');
  }

  const nextDepth = context.depth + 1;
  if (nextDepth > maxDepth) {
    return {
      kind: 'rejected',
      reason: 'max-depth',
    };
  }

  const pathApi = options.pathApi ?? path;
  const caseSensitive = options.caseSensitive ?? process.platform !== 'win32';
  const targetKey = createPathKey(
    canonicalTargetPath,
    pathApi,
    caseSensitive,
  );
  const isCycle = context.canonicalAncestors.some(
    (ancestorPath) => createPathKey(
      ancestorPath,
      pathApi,
      caseSensitive,
    ) === targetKey,
  );
  if (isCycle) {
    return {
      kind: 'rejected',
      reason: 'cycle',
    };
  }

  return {
    context: {
      canonicalAncestors: [
        ...context.canonicalAncestors,
        canonicalTargetPath,
      ],
      depth: nextDepth,
    },
    kind: 'allowed',
  };
}

