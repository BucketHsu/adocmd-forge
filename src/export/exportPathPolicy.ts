import path from 'node:path';

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F]/u;
const URI_SCHEME_PATTERN = /^[a-z][a-z\d+.-]*:/iu;

export class ExportPathPolicyError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ExportPathPolicyError';
  }
}

export interface ResolvedExportPath {
  readonly destinationPath: string;
  readonly destinationDirectory: string;
}

export interface ResolvedLocalResource {
  readonly absolutePath: string;
  readonly suffix: string;
}

export function resolveExportPath(
  sourcePath: string,
  workspaceRootPath: string,
  destinationPath: string,
): ResolvedExportPath {
  validateWorkspacePath(sourcePath, workspaceRootPath, '來源文件');
  if (!isNonEmptySafePath(destinationPath)) {
    throw new ExportPathPolicyError('匯出目的地不是有效的檔案路徑。');
  }

  const destination = path.resolve(destinationPath);
  const root = path.resolve(workspaceRootPath);
  if (!isPathWithinRoot(destination, root)) {
    throw new ExportPathPolicyError('匯出目的地必須位於目前工作區內。');
  }
  if (path.resolve(sourcePath) === destination) {
    throw new ExportPathPolicyError('匯出目的地不可覆蓋來源文件。');
  }

  return {
    destinationPath: destination,
    destinationDirectory: path.dirname(destination),
  };
}

export function validateWorkspacePath(
  documentPath: string,
  workspaceRootPath: string,
  label: string,
): void {
  if (!isNonEmptySafePath(documentPath) || !isNonEmptySafePath(workspaceRootPath)) {
    throw new ExportPathPolicyError(`${label}路徑不是有效的檔案系統路徑。`);
  }

  if (!isPathWithinRoot(documentPath, workspaceRootPath)) {
    throw new ExportPathPolicyError(`${label}必須位於目前工作區內。`);
  }
}

/**
 * 將 renderer 產生的相對 href/src 解析為工作區內資源。
 * 外部 URI、fragment 與不安全路徑不會交給檔案系統。
 */
export function resolveLocalResource(
  sourcePath: string | undefined,
  workspaceRootPath: string | undefined,
  reference: string,
): ResolvedLocalResource | undefined {
  if (
    sourcePath === undefined
    || workspaceRootPath === undefined
    || reference.length === 0
    || reference !== reference.trim()
    || CONTROL_CHARACTER_PATTERN.test(reference)
    || reference.startsWith('//')
  ) {
    return undefined;
  }

  const suffixIndex = reference.search(/[?#]/u);
  const pathname = suffixIndex === -1
    ? reference
    : reference.slice(0, suffixIndex);
  const suffix = suffixIndex === -1 ? '' : reference.slice(suffixIndex);
  if (pathname.length === 0 || URI_SCHEME_PATTERN.test(pathname)) {
    return undefined;
  }

  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    return undefined;
  }
  if (
    decodedPath.length === 0
    || CONTROL_CHARACTER_PATTERN.test(decodedPath)
    || path.isAbsolute(decodedPath)
  ) {
    return undefined;
  }

  const absolutePath = path.resolve(path.dirname(sourcePath), decodedPath);
  return isPathWithinRoot(absolutePath, workspaceRootPath)
    ? { absolutePath, suffix }
    : undefined;
}

export function createPortableRelativePath(
  fromDirectory: string,
  targetPath: string,
): string {
  const relativePath = path.relative(fromDirectory, targetPath).replaceAll('\\', '/');
  return encodeURI(relativePath.length === 0 ? path.basename(targetPath) : relativePath);
}

export function isPathWithinRoot(
  candidatePath: string,
  rootPath: string,
): boolean {
  const candidate = path.resolve(candidatePath);
  const root = path.resolve(rootPath);
  const relative = path.relative(root, candidate);
  return relative === ''
    || (
      relative !== '..'
      && !relative.startsWith(`..${path.sep}`)
      && !path.isAbsolute(relative)
    );
}

function isNonEmptySafePath(value: string): boolean {
  return value.length > 0
    && value === value.trim()
    && !CONTROL_CHARACTER_PATTERN.test(value);
}
