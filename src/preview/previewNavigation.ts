import path from 'node:path';

import { parseSourceLineFragment } from './sourceLineFragment';

export { parseSourceLineFragment } from './sourceLineFragment';

export type ExternalPreviewNavigationScheme = 'http' | 'https' | 'mailto';

export type PreviewNavigationRejectionReason =
  | 'control-character'
  | 'empty-href'
  | 'invalid-input'
  | 'invalid-local-reference'
  | 'outside-allowed-root'
  | 'protocol-relative'
  | 'unsupported-scheme';

export interface ExternalPreviewNavigation {
  readonly kind: 'external';
  readonly href: string;
  readonly scheme: ExternalPreviewNavigationScheme;
}

export interface LocalPreviewNavigation {
  readonly kind: 'local';
  readonly filePath: string;
  /**
   * 不含問號的原始 query；空字串表示連結未指定 query。
   */
  readonly query: string;
  /**
   * 已解碼且不含井字號的 fragment；空字串表示未指定 fragment。
   */
  readonly fragment: string;
  /**
   * `#Lx` 對應的零起算來源行號；一般 fragment 則為 null。
   */
  readonly sourceLine: number | null;
}

export interface RejectedPreviewNavigation {
  readonly kind: 'rejected';
  readonly reason: PreviewNavigationRejectionReason;
}

export type PreviewNavigationResult =
  | ExternalPreviewNavigation
  | LocalPreviewNavigation
  | RejectedPreviewNavigation;

export interface ResolvePreviewNavigationInput {
  readonly sourceFilePath?: string;
  readonly allowedRootPaths: readonly string[];
  readonly href: string;
}

type PathFlavor = 'posix' | 'win32';

interface LocalReferenceParts {
  readonly pathname: string;
  readonly query: string;
  readonly fragment: string;
}

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F]/u;
const SCHEME_PATTERN = /^([a-z][a-z\d+.-]*):/iu;
const WINDOWS_DRIVE_ABSOLUTE_PATTERN = /^[a-z]:[\\/]/iu;
const WINDOWS_DRIVE_RELATIVE_PATTERN = /^[a-z]:(?![\\/])/iu;
const externalSchemes = new Set<ExternalPreviewNavigationScheme>([
  'http',
  'https',
  'mailto',
]);

function reject(
  reason: PreviewNavigationRejectionReason,
): RejectedPreviewNavigation {
  return {
    kind: 'rejected',
    reason,
  };
}

function determinePathFlavor(sourceFilePath: string): PathFlavor | undefined {
  if (WINDOWS_DRIVE_ABSOLUTE_PATTERN.test(sourceFilePath)) {
    return 'win32';
  }

  if (path.posix.isAbsolute(sourceFilePath)) {
    return 'posix';
  }

  return undefined;
}

function isUncOrProtocolRelative(value: string): boolean {
  return value.startsWith('//') || value.startsWith('\\\\');
}

function isValidAbsolutePath(
  value: string,
  flavor: PathFlavor,
): boolean {
  if (
    value.length === 0
    || value !== value.trim()
    || CONTROL_CHARACTER_PATTERN.test(value)
    || isUncOrProtocolRelative(value)
  ) {
    return false;
  }

  if (flavor === 'win32') {
    return WINDOWS_DRIVE_ABSOLUTE_PATTERN.test(value)
      && path.win32.isAbsolute(value);
  }

  return path.posix.isAbsolute(value) && !value.includes('\\');
}

function parseExternalNavigation(
  href: string,
  scheme: string,
): ExternalPreviewNavigation | RejectedPreviewNavigation {
  if (!externalSchemes.has(scheme as ExternalPreviewNavigationScheme)) {
    return reject('unsupported-scheme');
  }

  const externalScheme = scheme as ExternalPreviewNavigationScheme;
  const authorityPrefix = `${externalScheme}://`;

  try {
    const parsed = new URL(href);
    if (
      parsed.protocol !== `${externalScheme}:`
      || (
        externalScheme !== 'mailto'
        && (
          !href.toLowerCase().startsWith(authorityPrefix)
          || href.slice(authorityPrefix.length).startsWith('/')
          || href.slice(authorityPrefix.length).startsWith('\\')
          || parsed.hostname.length === 0
        )
      )
    ) {
      return reject('unsupported-scheme');
    }

    return {
      kind: 'external',
      href: parsed.href,
      scheme: externalScheme,
    };
  } catch {
    return reject('unsupported-scheme');
  }
}

function splitLocalReference(href: string): LocalReferenceParts {
  const fragmentIndex = href.indexOf('#');
  const beforeFragment = fragmentIndex === -1
    ? href
    : href.slice(0, fragmentIndex);
  const encodedFragment = fragmentIndex === -1
    ? ''
    : href.slice(fragmentIndex + 1);
  const queryIndex = beforeFragment.indexOf('?');

  return {
    pathname: queryIndex === -1
      ? beforeFragment
      : beforeFragment.slice(0, queryIndex),
    query: queryIndex === -1
      ? ''
      : beforeFragment.slice(queryIndex + 1),
    fragment: decodeURIComponent(encodedFragment),
  };
}

function decodeLocalPathname(
  encodedPathname: string,
): string | undefined {
  try {
    return decodeURIComponent(encodedPathname);
  } catch {
    return undefined;
  }
}

function isAmbiguousLocalPathname(
  pathname: string,
  flavor: PathFlavor,
): boolean {
  if (
    CONTROL_CHARACTER_PATTERN.test(pathname)
    || isUncOrProtocolRelative(pathname)
  ) {
    return true;
  }

  if (flavor === 'win32') {
    return pathname.startsWith('\\')
      || pathname.startsWith('/')
      || path.win32.isAbsolute(pathname)
      || WINDOWS_DRIVE_RELATIVE_PATTERN.test(pathname)
      || pathname.includes(':');
  }

  return pathname.startsWith('/')
    || pathname.includes('\\')
    || path.posix.isAbsolute(pathname);
}

function isPathWithinRoot(
  targetPath: string,
  rootPath: string,
  flavor: PathFlavor,
): boolean {
  const pathImplementation = flavor === 'win32' ? path.win32 : path.posix;
  const relativePath = pathImplementation.relative(rootPath, targetPath);

  return relativePath === ''
    || (
      relativePath !== '..'
      && !relativePath.startsWith(`..${pathImplementation.sep}`)
      && !pathImplementation.isAbsolute(relativePath)
    );
}

/**
 * 將預覽中的連結分類為可開啟的外部 URI、本機檔案或拒絕結果。
 *
 * 本函式只做字串正規化與詞法上的根目錄包含檢查，不讀取檔案系統，也不宣稱
 * 能辨識符號連結是否指向允許根目錄之外。呼叫端若允許不受信任的符號連結，
 * 仍須在實際存取檔案前另外執行實體路徑政策。
 */
export function resolvePreviewNavigation(
  input: ResolvePreviewNavigationInput,
): PreviewNavigationResult {
  const {
    sourceFilePath,
    allowedRootPaths,
    href,
  } = input;

  if (href.length === 0 || href.trim().length === 0) {
    return reject('empty-href');
  }

  if (href !== href.trim() || CONTROL_CHARACTER_PATTERN.test(href)) {
    return reject('control-character');
  }

  if (isUncOrProtocolRelative(href)) {
    return reject('protocol-relative');
  }

  const scheme = SCHEME_PATTERN.exec(href)?.[1]?.toLowerCase();
  if (scheme !== undefined) {
    return parseExternalNavigation(href, scheme);
  }

  if (sourceFilePath === undefined) {
    return reject('invalid-input');
  }

  const flavor = determinePathFlavor(sourceFilePath);
  if (
    flavor === undefined
    || !isValidAbsolutePath(sourceFilePath, flavor)
    || allowedRootPaths.length === 0
    || !allowedRootPaths.every((rootPath) => (
      isValidAbsolutePath(rootPath, flavor)
    ))
  ) {
    return reject('invalid-input');
  }

  let reference: LocalReferenceParts;
  try {
    reference = splitLocalReference(href);
  } catch {
    return reject('invalid-local-reference');
  }

  const decodedPathname = decodeLocalPathname(reference.pathname);
  if (
    decodedPathname === undefined
    || isAmbiguousLocalPathname(decodedPathname, flavor)
  ) {
    return isUncOrProtocolRelative(decodedPathname ?? '')
      ? reject('protocol-relative')
      : reject('invalid-local-reference');
  }

  const pathImplementation = flavor === 'win32' ? path.win32 : path.posix;
  const normalizedSourcePath = pathImplementation.normalize(sourceFilePath);
  const targetPath = decodedPathname.length === 0
    ? normalizedSourcePath
    : pathImplementation.resolve(
      pathImplementation.dirname(normalizedSourcePath),
      decodedPathname,
    );
  const normalizedRootPaths = allowedRootPaths.map((rootPath) => (
    pathImplementation.normalize(rootPath)
  ));

  if (
    !normalizedRootPaths.some((rootPath) => (
      isPathWithinRoot(targetPath, rootPath, flavor)
    ))
  ) {
    return reject('outside-allowed-root');
  }

  return {
    kind: 'local',
    filePath: targetPath,
    query: reference.query,
    fragment: reference.fragment,
    sourceLine: parseSourceLineFragment(reference.fragment),
  };
}
