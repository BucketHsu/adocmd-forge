import path from 'node:path';

export interface SplitReferenceTarget {
  readonly path: string;
  readonly fragment: string | undefined;
}

export type LinkTargetKind = 'external' | 'internal' | 'local' | 'unsafe' | 'unavailable';

export interface ResolvedLinkTarget {
  readonly kind: LinkTargetKind;
  readonly path: string | undefined;
  readonly fragment: string | undefined;
  readonly reason?: string;
}

/** 將 URI query 與 fragment 分離，並拒絕無法安全解碼的值。 */
export function splitReferenceTarget(target: string): SplitReferenceTarget {
  const normalized = target.trim();
  const hashIndex = normalized.indexOf('#');
  const pathAndQuery = hashIndex < 0 ? normalized : normalized.slice(0, hashIndex);
  const rawFragment = hashIndex < 0 ? undefined : normalized.slice(hashIndex + 1);
  const queryIndex = pathAndQuery.indexOf('?');
  const rawPath = queryIndex < 0 ? pathAndQuery : pathAndQuery.slice(0, queryIndex);
  const fragment = rawFragment === undefined
    ? undefined
    : decodeUriPart(rawFragment);
  return {
    path: decodeUriPart(rawPath),
    fragment: fragment?.split('?')[0],
  };
}

/**
 * 將引用目標解析為可檢查的本機路徑。所有本機路徑都必須位於 workspace root，
 * 因此 `..`、UNC、外部絕對路徑與跨工作區參照不會被送入檔案系統。
 */
export function resolveLinkTarget(
  sourcePath: string | undefined,
  target: string,
  workspaceRoots: readonly string[],
): ResolvedLinkTarget {
  const split = splitReferenceTarget(target);
  if (isExternalTarget(split.path)) {
    return {
      kind: 'external',
      path: undefined,
      fragment: split.fragment,
    };
  }

  const localTargetPath = parseFileUriPath(split.path);
  if (localTargetPath === undefined) {
    return {
      kind: 'unsafe',
      path: undefined,
      fragment: split.fragment,
      reason: '引用 URI 格式無法安全解析。',
    };
  }

  if (localTargetPath.length === 0) {
    return {
      kind: 'internal',
      path: sourcePath,
      fragment: split.fragment,
    };
  }

  if (hasUnresolvedAttribute(localTargetPath)) {
    return {
      kind: 'unavailable',
      path: undefined,
      fragment: split.fragment,
      reason: '引用包含尚未解析的文件屬性。',
    };
  }

  if (sourcePath === undefined || workspaceRoots.length === 0) {
    return {
      kind: 'unavailable',
      path: undefined,
      fragment: split.fragment,
      reason: '目前文件沒有可驗證的 workspace 路徑。',
    };
  }

  const pathApi = choosePathApi(sourcePath, [...workspaceRoots, localTargetPath]);
  const sourceForApi = normalizeForPathApi(sourcePath, pathApi);
  const targetForApi = normalizeForPathApi(localTargetPath, pathApi);
  const resolved = pathApi.resolve(
    pathApi.isAbsolute(targetForApi)
      ? targetForApi
      : pathApi.join(pathApi.dirname(sourceForApi), targetForApi),
  );
  const rootsForApi = workspaceRoots.map((root) => (
    pathApi.resolve(normalizeForPathApi(root, pathApi))
  ));

  if (!rootsForApi.some((root) => isWithinPath(resolved, root, pathApi))) {
    return {
      kind: 'unsafe',
      path: undefined,
      fragment: split.fragment,
      reason: '引用路徑超出目前 workspace 範圍。',
    };
  }

  return {
    kind: 'local',
    path: resolved,
    fragment: split.fragment,
  };
}

export function pathsEqual(left: string, right: string): boolean {
  const pathApi = choosePathApi(left, [right]);
  const leftResolved = pathApi.resolve(normalizeForPathApi(left, pathApi));
  const rightResolved = pathApi.resolve(normalizeForPathApi(right, pathApi));
  return pathApi === path.win32
    ? leftResolved.toLocaleLowerCase() === rightResolved.toLocaleLowerCase()
    : leftResolved === rightResolved;
}

export function isExternalTarget(target: string): boolean {
  if (isWindowsPath(target)) {
    return false;
  }
  return /^(?:https?|mailto|data|ftp):/iu.test(target)
    || (/^[a-z][a-z\d+.-]*:/iu.test(target) && !/^file:/iu.test(target))
    || target.startsWith('//');
}

interface PathApi {
  readonly relative: (from: string, to: string) => string;
  readonly isAbsolute: (value: string) => boolean;
  readonly resolve: (...values: string[]) => string;
  readonly dirname: (value: string) => string;
  readonly join: (...values: string[]) => string;
}

function isWithinPath(
  candidate: string,
  root: string,
  pathApi: PathApi,
): boolean {
  const relative = pathApi.relative(root, candidate);
  return relative.length === 0
    || (!relative.startsWith('..') && !pathApi.isAbsolute(relative));
}

function choosePathApi(
  sourcePath: string,
  workspaceRoots: readonly string[],
): PathApi {
  return isWindowsPath(sourcePath) || workspaceRoots.some(isWindowsPath)
    ? path.win32
    : path.posix;
}

function normalizeForPathApi(
  value: string,
  pathApi: PathApi,
): string {
  return pathApi === path.win32
    ? value.replaceAll('/', '\\')
    : value.replaceAll('\\', '/');
}

function isWindowsPath(value: string): boolean {
  return /^[a-z]:[\\/]/iu.test(value) || value.startsWith('\\\\');
}

function hasUnresolvedAttribute(value: string): boolean {
  return /(?:\$\{[^}]+\}|\{[^}]+\})/u.test(value);
}

function parseFileUriPath(value: string): string | undefined {
  if (!/^file:/iu.test(value)) {
    return value;
  }
  try {
    const uri = new URL(value);
    if (uri.protocol.toLocaleLowerCase() !== 'file:') {
      return undefined;
    }
    const host = uri.hostname;
    const pathname = decodeUriPart(uri.pathname);
    if (host.length > 0 && host !== 'localhost') {
      return `\\\\${host}${pathname.replaceAll('/', '\\')}`;
    }
    return /^[a-z]:/iu.test(pathname.slice(1)) ? pathname.slice(1) : pathname;
  } catch {
    return undefined;
  }
}

function decodeUriPart(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
