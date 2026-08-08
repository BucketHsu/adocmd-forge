import path from 'node:path';

const URI_SCHEME_PATTERN = /^[a-z][a-z\d+.-]*:/iu;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F]/u;

export interface LocalPreviewResource {
  readonly kind: 'local';
  readonly path: string;
}

export interface ExternalPreviewResource {
  readonly kind: 'external';
}

export interface RejectedPreviewResource {
  readonly kind: 'rejected';
}

export type PreviewResourceResolution =
  | LocalPreviewResource
  | ExternalPreviewResource
  | RejectedPreviewResource;

export function createAllowedRootPaths(
  sourceFilePath: string | undefined,
  workspaceRootPaths: readonly string[],
): string[] {
  const rootPaths = [...workspaceRootPaths];
  if (sourceFilePath !== undefined) {
    rootPaths.push(path.dirname(sourceFilePath));
  }

  return [...new Set(rootPaths.map((rootPath) => path.resolve(rootPath)))];
}

/**
 * 將圖片來源限制在文件目錄或工作區內。
 *
 * 這是字面路徑邊界檢查；實際可載入範圍仍由 Webview 的 localResourceRoots 再限制。
 */
export function resolvePreviewImage(
  sourceFilePath: string | undefined,
  allowedRootPaths: readonly string[],
  imageSource: string,
): PreviewResourceResolution {
  if (
    imageSource.length === 0
    || imageSource !== imageSource.trim()
    || CONTROL_CHARACTER_PATTERN.test(imageSource)
    || imageSource.startsWith('//')
  ) {
    return { kind: 'rejected' };
  }

  const scheme = URI_SCHEME_PATTERN.exec(imageSource)?.[0].toLowerCase();
  if (scheme === 'https:') {
    return { kind: 'external' };
  }
  if (scheme !== undefined || sourceFilePath === undefined) {
    return { kind: 'rejected' };
  }

  const pathPart = imageSource.split(/[?#]/u, 1)[0];
  if (pathPart === undefined || pathPart.length === 0) {
    return { kind: 'rejected' };
  }

  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(pathPart);
  } catch {
    return { kind: 'rejected' };
  }
  if (CONTROL_CHARACTER_PATTERN.test(decodedPath)) {
    return { kind: 'rejected' };
  }

  const candidatePath = path.resolve(
    path.dirname(sourceFilePath),
    decodedPath,
  );
  const isAllowed = allowedRootPaths.some(
    (rootPath) => isPathWithinRoot(candidatePath, rootPath),
  );

  return isAllowed
    ? {
        kind: 'local',
        path: candidatePath,
      }
    : { kind: 'rejected' };
}

/**
 * 將 renderer 提供的 stylesheet 候選路徑限制在允許的本機根目錄內。
 *
 * 實體檔案與 symlink 邊界由 PreviewSession 以 realpath 再驗證；此函式
 * 先拒絕相對路徑、URI、控制字元及非 CSS 副檔名，避免把任意值交給 URI
 * 轉換或 Webview。
 */
export function resolvePreviewStylesheet(
  allowedRootPaths: readonly string[],
  stylesheetPath: string,
): string | undefined {
  if (
    stylesheetPath.length === 0
    || stylesheetPath !== stylesheetPath.trim()
    || CONTROL_CHARACTER_PATTERN.test(stylesheetPath)
    || URI_SCHEME_PATTERN.test(stylesheetPath)
    || !path.isAbsolute(stylesheetPath)
    || path.extname(stylesheetPath).toLowerCase() !== '.css'
  ) {
    return undefined;
  }

  const candidatePath = path.resolve(stylesheetPath);
  return allowedRootPaths.some(
    (rootPath) => isPathWithinRoot(candidatePath, rootPath),
  )
    ? candidatePath
    : undefined;
}

export function isPathWithinRoot(
  candidatePath: string,
  rootPath: string,
): boolean {
  const relativePath = path.relative(
    path.resolve(rootPath),
    path.resolve(candidatePath),
  );

  return relativePath === ''
    || (
      relativePath !== '..'
      && !relativePath.startsWith(`..${path.sep}`)
      && !path.isAbsolute(relativePath)
    );
}
