import type { ImageDocumentKind } from './imageTypes';

export function buildImageSyntax(
  language: ImageDocumentKind,
  relativePath: string,
  altText: string,
): string {
  const normalizedPath = normalizeRelativePath(relativePath);
  const normalizedAltText = normalizeAltText(altText, normalizedPath);

  if (language === 'asciidoc') {
    return `image::${escapeAsciiDocPath(normalizedPath)}[${escapeAsciiDocAttribute(normalizedAltText)}]`;
  }

  return `![${escapeMarkdownAltText(normalizedAltText)}](${escapeMarkdownPath(normalizedPath)})`;
}

function normalizeRelativePath(value: string): string {
  const normalized = value.replaceAll('\\', '/').replace(/^\.\//u, '');
  if (
    normalized.length === 0
    || normalized.startsWith('/')
    || /^[A-Za-z]:([/]|$)/u.test(normalized)
  ) {
    throw new Error('圖片語法需要工作區內的相對路徑。');
  }

  return normalized;
}

function normalizeAltText(value: string, relativePath: string): string {
  const normalized = value.trim();
  if (normalized.length > 0) {
    return normalized;
  }

  const fileName = relativePath.split('/').pop() ?? 'image';
  return fileName.replace(/\.[^.]+$/u, '');
}

function escapeAsciiDocPath(value: string): string {
  return value.replaceAll('[', '\\[').replaceAll(']', '\\]');
}

function escapeAsciiDocAttribute(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll(']', '\\]');
}

function escapeMarkdownAltText(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll(']', '\\]').replaceAll('[', '\\[');
}

function escapeMarkdownPath(value: string): string {
  return value.replaceAll(' ', '%20').replaceAll('(', '%28').replaceAll(')', '%29');
}
