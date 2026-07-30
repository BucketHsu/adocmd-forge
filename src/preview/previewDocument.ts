import path from 'node:path';

import type { DocumentKind } from '../models/documentKind';

const EXTENSION_KIND_BY_NAME: Readonly<Record<string, DocumentKind>> = {
  '.adoc': 'asciidoc',
  '.asciidoc': 'asciidoc',
  '.md': 'markdown',
};

/**
 * 依 VS Code 語言識別碼判斷文件類型，副檔名則作為尚未套用語言模式時的後援。
 */
export function resolveDocumentKind(
  languageId: string,
  fileName: string,
): DocumentKind | undefined {
  if (languageId === 'asciidoc') {
    return 'asciidoc';
  }
  if (languageId === 'markdown') {
    return 'markdown';
  }

  return EXTENSION_KIND_BY_NAME[path.extname(fileName).toLowerCase()];
}

export function createPreviewTitle(fileName: string): string {
  const baseName = path.basename(fileName);
  return `${baseName.length > 0 ? baseName : 'Untitled'} Preview`;
}
