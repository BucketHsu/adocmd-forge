import path from 'node:path';

export const SUPPORTED_IMAGE_MIME_TYPES = new Set([
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/svg+xml',
  'image/webp',
]);

export const IMAGE_EXTENSION_BY_MIME_TYPE: Readonly<Record<string, string>> = {
  'image/gif': '.gif',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/svg+xml': '.svg',
  'image/webp': '.webp',
};

export const SUPPORTED_IMAGE_EXTENSIONS = new Set([
  '.gif',
  '.jpeg',
  '.jpg',
  '.png',
  '.svg',
  '.webp',
]);

const WINDOWS_RESERVED_NAMES = new Set([
  'aux',
  'clock$',
  'con',
  'nul',
  'prn',
  'com1',
  'com2',
  'com3',
  'com4',
  'com5',
  'com6',
  'com7',
  'com8',
  'com9',
  'lpt1',
  'lpt2',
  'lpt3',
  'lpt4',
  'lpt5',
  'lpt6',
  'lpt7',
  'lpt8',
  'lpt9',
]);

export class ImagePathPolicyError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ImagePathPolicyError';
  }
}

export function inferImageExtension(
  name: string,
  mimeType: string | undefined,
): string {
  const extension = getExtension(name);
  const normalizedMimeType = normalizeMimeType(mimeType);

  if (extension !== undefined && !SUPPORTED_IMAGE_EXTENSIONS.has(extension)) {
    throw new ImagePathPolicyError(
      `不支援的圖片副檔名「${extension}」，僅支援 PNG、JPG、GIF、WebP 與 SVG。`,
    );
  }

  if (
    normalizedMimeType !== undefined
    && !SUPPORTED_IMAGE_MIME_TYPES.has(normalizedMimeType)
  ) {
    throw new ImagePathPolicyError(
      `不支援的圖片格式「${normalizedMimeType}」，僅支援 PNG、JPG、GIF、WebP 與 SVG。`,
    );
  }

  if (extension !== undefined && normalizedMimeType !== undefined) {
    const mimeExtension = IMAGE_EXTENSION_BY_MIME_TYPE[normalizedMimeType];
    const extensionsMatch = extension === mimeExtension
      || (extension === '.jpeg' && mimeExtension === '.jpg');
    if (!extensionsMatch) {
      throw new ImagePathPolicyError('圖片副檔名與 MIME 類型不一致。');
    }
  }

  if (extension !== undefined) {
    return extension === '.jpeg' ? '.jpg' : extension;
  }

  if (normalizedMimeType !== undefined) {
    const mimeExtension = IMAGE_EXTENSION_BY_MIME_TYPE[normalizedMimeType];
    if (mimeExtension !== undefined) {
      return mimeExtension;
    }
  }

  throw new ImagePathPolicyError(
    '無法判斷圖片格式，請提供支援的副檔名或 MIME 類型。',
  );
}

export function sanitizeImageFileName(
  name: string,
  mimeType?: string,
): string {
  const extension = inferImageExtension(name, mimeType);
  const baseName = basename(name);
  const originalExtension = getExtension(name);
  const rawName = baseName.slice(
    0,
    originalExtension === undefined
      ? baseName.length
      : Math.max(0, baseName.length - originalExtension.length),
  );
  const safeBaseName = sanitizeBaseName(rawName);
  return `${safeBaseName}${extension}`;
}

export function normalizeImageDirectory(directory: string): string {
  const normalized = directory.trim().replaceAll('\\', '/');
  if (normalized.length === 0) {
    throw new ImagePathPolicyError('圖片目錄不可為空。');
  }

  if (
    normalized.startsWith('/')
    || /^[A-Za-z]:([/]|$)/u.test(normalized)
  ) {
    throw new ImagePathPolicyError('圖片目錄必須是工作區內的相對路徑。');
  }

  const segments = normalized.split('/').filter((segment) => segment.length > 0);
  if (segments.some((segment) => segment === '..' || segment.includes('\0'))) {
    throw new ImagePathPolicyError('圖片目錄不可包含路徑穿越。');
  }

  const result = path.posix.normalize(segments.join('/'));
  if (result === '.' || result.startsWith('../') || result === '..') {
    throw new ImagePathPolicyError('圖片目錄不可離開目前文件的工作區範圍。');
  }

  return result;
}

export function isPathWithinRoot(candidatePath: string, rootPath: string): boolean {
  const candidate = normalizePath(candidatePath);
  const root = normalizePath(rootPath);
  return candidate === root || candidate.startsWith(`${root}/`);
}

export function resolveDefaultImagePath(
  documentPath: string,
  workspaceRootPath: string,
  directory: string,
  fileName: string,
): { readonly targetPath: string; readonly relativePath: string } {
  const normalizedDocumentPath = normalizePath(documentPath);
  const normalizedRootPath = normalizePath(workspaceRootPath);
  const normalizedDirectory = normalizeImageDirectory(directory);
  const documentDirectory = path.posix.dirname(normalizedDocumentPath);
  const targetDirectory = path.posix.join(documentDirectory, normalizedDirectory);
  const targetPath = path.posix.join(targetDirectory, fileName);

  if (!isPathWithinRoot(targetDirectory, normalizedRootPath)) {
    throw new ImagePathPolicyError('圖片目錄必須位於目前工作區資料夾內。');
  }

  return {
    targetPath,
    relativePath: toPosixRelativePath(normalizedDocumentPath, targetPath),
  };
}

export function resolveSelectedImagePath(
  documentPath: string,
  workspaceRootPath: string,
  selectedPath: string,
  sourceExtension: string,
): { readonly targetPath: string; readonly relativePath: string } {
  const normalizedDocumentPath = normalizePath(documentPath);
  const normalizedRootPath = normalizePath(workspaceRootPath);
  const normalizedSelectedPath = normalizePath(selectedPath);
  const targetDirectory = path.posix.dirname(normalizedSelectedPath);

  if (!isPathWithinRoot(targetDirectory, normalizedRootPath)) {
    throw new ImagePathPolicyError('圖片儲存位置必須位於目前工作區資料夾內。');
  }

  const selectedExtension = getExtension(normalizedSelectedPath);
  const targetPath = selectedExtension === undefined
    ? `${normalizedSelectedPath}${sourceExtension}`
    : normalizedSelectedPath;

  if (getExtension(targetPath) !== sourceExtension) {
    throw new ImagePathPolicyError('儲存檔案的副檔名必須與圖片格式一致。');
  }

  if (!isPathWithinRoot(targetPath, normalizedRootPath)) {
    throw new ImagePathPolicyError('圖片儲存位置必須位於目前工作區資料夾內。');
  }

  return {
    targetPath,
    relativePath: toPosixRelativePath(normalizedDocumentPath, targetPath),
  };
}

export function toPosixRelativePath(fromPath: string, targetPath: string): string {
  const normalizedFromPath = normalizePath(fromPath);
  const relativePath = path.posix.relative(
    path.posix.dirname(normalizedFromPath),
    normalizePath(targetPath),
  );
  return relativePath.length === 0 ? path.posix.basename(targetPath) : relativePath;
}

export function getExtension(name: string): string | undefined {
  const baseName = basename(name);
  const extension = path.posix.extname(baseName).toLowerCase();
  return extension.length > 0 ? extension : undefined;
}

function basename(value: string): string {
  const normalized = value.replaceAll('\\', '/');
  return path.posix.basename(normalized);
}

function sanitizeBaseName(value: string): string {
  const sanitized = value
    .replaceAll('\0', '')
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/^[.-]+/u, '')
    .replace(/[. -]+$/u, '')
    .trim();
  const fallback = sanitized.length > 0 ? sanitized : 'image';
  return WINDOWS_RESERVED_NAMES.has(fallback.toLowerCase())
    ? `_${fallback}`
    : fallback;
}

function normalizePath(value: string): string {
  const normalized = value.replaceAll('\\', '/');
  const result = path.posix.normalize(normalized);
  return result.endsWith('/') && result.length > 1
    ? result.slice(0, -1)
    : result;
}

function normalizeMimeType(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const normalized = value.split(';', 1)[0]?.trim().toLowerCase();
  return normalized === undefined || normalized.length === 0
    ? undefined
    : normalized;
}
