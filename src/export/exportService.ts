import path from 'node:path';

import {
  sanitizeRenderedHtml,
} from '../renderer/htmlSanitizer';
import { buildExportHtml } from './exportHtmlBuilder';
import {
  createPortableRelativePath,
  resolveExportPath,
  resolveLocalResource,
} from './exportPathPolicy';
import type {
  ExportFileMimeType,
  ExportFileSystem,
  ExportInput,
  ExportOutput,
  ExportRenderer,
} from './exportTypes';

const IMAGE_MIME_TYPES: readonly ExportFileMimeType[] = [
  { extension: '.gif', mimeType: 'image/gif' },
  { extension: '.jpeg', mimeType: 'image/jpeg' },
  { extension: '.jpg', mimeType: 'image/jpeg' },
  { extension: '.png', mimeType: 'image/png' },
  { extension: '.svg', mimeType: 'image/svg+xml' },
  { extension: '.webp', mimeType: 'image/webp' },
];
const IMG_TAG_PATTERN = /<img\b[^>]*\bsrc=(['"])(.*?)\1[^>]*>/giu;
const SRC_ATTRIBUTE_PATTERN = /\s+src=(['"])(.*?)\1/iu;
const HREF_ATTRIBUTE_PATTERN = /\s+href=(['"])(.*?)\1/iu;
const URL_SCHEME_PATTERN = /^[a-z][a-z\d+.-]*:/iu;

export class ExportService {
  public constructor(
    private readonly fileSystem: ExportFileSystem,
    private readonly renderer: ExportRenderer,
  ) {}

  public async export(input: ExportInput): Promise<ExportOutput> {
    const destinationPath = input.destinationPath;
    const sourcePath = input.sourcePath;
    const workspaceRootPath = input.workspaceRootPath;
    if (destinationPath !== undefined) {
      if (!input.workspaceTrusted) {
        throw new Error('HTML 匯出需要受信任的工作區。');
      }
      if (sourcePath === undefined || workspaceRootPath === undefined) {
        throw new Error('HTML 匯出需要已儲存且位於工作區內的文件。');
      }
      const destination = resolveExportPath(
        sourcePath,
        workspaceRootPath,
        destinationPath,
      );
      const destinationStat = await this.fileSystem.stat(destination.destinationPath);
      if (destinationStat.type === 'directory') {
        throw new Error('匯出目的地必須是檔案，而不是資料夾。');
      }
      if (destinationStat.type === 'file' && input.overwrite !== true) {
        throw new Error('匯出檔案已存在；請確認覆寫後再試。');
      }
    }

    const renderResult = await this.renderer({
      kind: input.kind,
      source: input.source,
      ...(input.sourcePath === undefined ? {} : { sourcePath: input.sourcePath }),
      ...(input.workspaceRootPath === undefined ? {} : {
        allowedIncludeRootPaths: [input.workspaceRootPath],
      }),
      allowLocalIncludes: input.workspaceTrusted,
    });
    const title = renderResult.title ?? getFallbackTitle(input.sourcePath);
    const fragment = await this.createFragment(
      renderResult.html,
      input,
    );
    const content = buildExportHtml(input.format, fragment, title);

    if (destinationPath !== undefined) {
      if (sourcePath === undefined || workspaceRootPath === undefined) {
        throw new Error('HTML 匯出需要已儲存且位於工作區內的文件。');
      }
      const destination = resolveExportPath(sourcePath, workspaceRootPath, destinationPath);
      await this.fileSystem.createDirectory(destination.destinationDirectory);
      await this.fileSystem.writeFile(
        destination.destinationPath,
        new TextEncoder().encode(content),
      );
      return {
        content,
        destinationPath: destination.destinationPath,
        ...(renderResult.title === undefined ? {} : { title: renderResult.title }),
      };
    }

    return {
      content,
      ...(renderResult.title === undefined ? {} : { title: renderResult.title }),
    };
  }

  private async createFragment(
    html: string,
    input: ExportInput,
  ): Promise<string> {
    const sanitized = sanitizeRenderedHtml(html);
    if (input.format === 'embedded-html') {
      return sanitized;
    }

    const sourcePath = input.sourcePath;
    const workspaceRootPath = input.workspaceRootPath;
    const destinationPath = input.destinationPath;
    if (sourcePath === undefined || workspaceRootPath === undefined || destinationPath === undefined) {
      return sanitizeRenderedHtml(sanitized);
    }

    let rewritten = await replaceImageTags(
      sanitized,
      async (tag, source): Promise<string> => {
        const resource = resolveLocalResource(
          sourcePath,
          workspaceRootPath,
          source,
        );
        if (resource === undefined) {
          return removeAttribute(tag, 'src');
        }

        if (input.format === 'standalone-html') {
          const dataUri = await this.readDataUri(resource.absolutePath);
          return dataUri === undefined
            ? removeAttribute(tag, 'src')
            : replaceAttribute(tag, 'src', dataUri);
        }

        const relativePath = createPortableRelativePath(
          path.dirname(destinationPath),
          resource.absolutePath,
        );
        return replaceAttribute(tag, 'src', `${relativePath}${resource.suffix}`);
      },
    );
    rewritten = rewriteLinks(
      rewritten,
      sourcePath,
      workspaceRootPath,
      destinationPath,
    );
    return input.format === 'standalone-html'
      ? sanitizeRenderedHtml(rewritten, { allowDataImages: true })
      : sanitizeRenderedHtml(rewritten);
  }

  private async readDataUri(filePath: string): Promise<string | undefined> {
    try {
      const data = await this.fileSystem.readFile(filePath);
      const mimeType = getImageMimeType(filePath);
      if (mimeType === undefined) {
        return undefined;
      }
      return `data:${mimeType};base64,${Buffer.from(data).toString('base64')}`;
    } catch {
      return undefined;
    }
  }
}

async function replaceImageTags(
  html: string,
  replacer: (tag: string, source: string) => Promise<string>,
): Promise<string> {
  const matches = [...html.matchAll(IMG_TAG_PATTERN)];
  let result = '';
  let offset = 0;
  for (const match of matches) {
    const tag = match[0];
    const source = match[2] ?? '';
    if (tag.length === 0 || source.length === 0) {
      continue;
    }
    result += html.slice(offset, match.index);
    result += await replacer(tag, decodeHtmlAttribute(source));
    offset = match.index + tag.length;
  }
  return result + html.slice(offset);
}

function rewriteLinks(
  html: string,
  sourcePath: string,
  workspaceRootPath: string,
  destinationPath: string,
): string {
  return html.replace(
    /<a\b[^>]*\bhref=(['"])(.*?)\1[^>]*>/giu,
    (tag: string, _quote: string, rawHref: string): string => {
      const href = decodeHtmlAttribute(rawHref);
      if (href.startsWith('#') || URL_SCHEME_PATTERN.test(href)) {
        return tag;
      }
      const resource = resolveLocalResource(sourcePath, workspaceRootPath, href);
      if (resource === undefined) {
        return removeAttribute(tag, 'href');
      }
      const relativePath = createPortableRelativePath(
        path.dirname(destinationPath),
        resource.absolutePath,
      );
      return replaceAttribute(tag, 'href', `${relativePath}${resource.suffix}`);
    },
  );
}

function getImageMimeType(filePath: string): string | undefined {
  const extension = path.extname(filePath).toLowerCase();
  return IMAGE_MIME_TYPES.find(({ extension: candidate }) => candidate === extension)?.mimeType;
}

function getFallbackTitle(sourcePath: string | undefined): string {
  return sourcePath === undefined
    ? 'AdocMD Forge Export'
    : path.basename(sourcePath, path.extname(sourcePath));
}

function replaceAttribute(tag: string, attribute: string, value: string): string {
  const escaped = escapeHtmlAttribute(value);
  const pattern = attribute === 'src' ? SRC_ATTRIBUTE_PATTERN : HREF_ATTRIBUTE_PATTERN;
  return pattern.test(tag)
    ? tag.replace(pattern, ` ${attribute}="${escaped}"`)
    : tag;
}

function removeAttribute(tag: string, attribute: 'src' | 'href'): string {
  const pattern = attribute === 'src' ? SRC_ATTRIBUTE_PATTERN : HREF_ATTRIBUTE_PATTERN;
  return tag.replace(pattern, '');
}

function decodeHtmlAttribute(value: string): string {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}
