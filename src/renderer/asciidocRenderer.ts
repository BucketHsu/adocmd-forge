import path from 'node:path';

import type {
  AbstractBlock,
  Document,
  LoggerMessage,
  ProcessorOptions,
} from '@asciidoctor/core';

import type { RenderRequest } from '../models/renderRequest';
import { createSecureIncludeRegistry } from './include/asciidoctorIncludeProcessor';
import type { RenderMessage } from '../models/renderMessage';
import createAsciidoctorRuntime from './asciidoctorRuntime.cjs';

interface RenderedFragment {
  readonly html: string;
  readonly messages?: readonly RenderMessage[];
  readonly stylesheets?: readonly string[];
  readonly title?: string;
}

const SOURCE_LINE_ATTRIBUTE = 'data-source-line';
const SOURCE_LINE_ROLE_PREFIX = 'adocmd-forge-source-line-';
const SOURCE_LINE_ROLE_PATTERN = /^adocmd-forge-source-line-(\d+)$/u;
const CLASS_ATTRIBUTE_PATTERN = /\sclass=(["'])(.*?)\1/giu;

const asciidoctor = createAsciidoctorRuntime();

/**
 * 將 AsciiDoc 轉為尚未消毒的 HTML fragment。
 */
export function renderAsciiDoc(request: RenderRequest): RenderedFragment {
  const previousLogger = asciidoctor.LoggerManager.getLogger();
  const memoryLogger = asciidoctor.MemoryLogger.create();
  asciidoctor.LoggerManager.setLogger(memoryLogger);

  try {
    const document = asciidoctor.load(
      request.source,
      createProcessorOptions(request),
    );
    const title = getPlainDocumentTitle(document);
    const stylesheets = resolveAsciiDocStylesheets(document, request);

    addSourceLineRoles(document);

    let html = replaceSourceLineRoles(document.convert());
    const documentLine = getMainDocumentSourceLine(document);
    if (title !== undefined && documentLine !== undefined) {
      html = addDocumentTitleSourceLine(html, documentLine);
    }

    const messages = memoryLogger.getMessages().map(toRenderMessage);
    return {
      html,
      ...(messages.length > 0 ? { messages } : {}),
      ...(stylesheets.length > 0 ? { stylesheets } : {}),
      ...(title === undefined ? {} : { title }),
    };
  } finally {
    asciidoctor.LoggerManager.setLogger(previousLogger);
  }
}

function toRenderMessage(loggerMessage: LoggerMessage): RenderMessage {
  let sourceLocation: unknown;
  try {
    sourceLocation = loggerMessage.getSourceLocation();
  } catch {
    sourceLocation = undefined;
  }

  const { lineNumber, sourceFile } = readSourceLocation(sourceLocation);
  const loggerSeverity = loggerMessage.getSeverity().toUpperCase();
  const severity = loggerSeverity === 'ERROR' || loggerSeverity === 'FATAL'
    ? 'error'
    : 'warning';

  return {
    message: loggerMessage.getText(),
    severity,
    ...(
      lineNumber === undefined
      || sourceFile !== undefined
        ? {}
        : {
            sourceLine: lineNumber - 1,
          }
    ),
  };
}

function readPositiveInteger(value: unknown): number | undefined {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 1
    ? value
    : undefined;
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0
    ? value
    : undefined;
}

interface SourceLocationValues {
  readonly lineNumber: number | undefined;
  readonly sourceFile: string | undefined;
}

/**
 * Asciidoctor 的來源位置不是所有 AST 節點都保證提供完整方法。
 * 只從可安全呼叫的 getter 讀取資料，缺少位置時保留可用的 HTML 預覽。
 */
function readSourceLocation(value: unknown): SourceLocationValues {
  return {
    lineNumber: readPositiveInteger(
      readSourceLocationGetter(value, 'getLineNumber'),
    ),
    sourceFile: readNonEmptyString(
      readSourceLocationGetter(value, 'getFile'),
    ),
  };
}

function readSourceLocationGetter(
  value: unknown,
  getterName: 'getFile' | 'getLineNumber',
): unknown {
  if (!isObjectLike(value)) {
    return undefined;
  }

  try {
    const getter = (value as Record<string, unknown>)[getterName];
    return typeof getter === 'function'
      ? Reflect.apply(getter, value, [])
      : undefined;
  } catch {
    return undefined;
  }
}

function isObjectLike(value: unknown): value is object {
  return value !== null
    && (typeof value === 'object' || typeof value === 'function');
}

function createProcessorOptions(request: RenderRequest): ProcessorOptions {
  const extensionRegistry = createExtensionRegistry(request);
  const options: ProcessorOptions = {
    attributes: {
      showtitle: true,
    },
    header_footer: false,
    safe: 'secure',
    sourcemap: true,
    ...(extensionRegistry === undefined ? {} : {
      extension_registry: extensionRegistry,
    }),
  };

  if (request.sourcePath !== undefined && request.sourcePath.length > 0) {
    options.base_dir = path.dirname(path.resolve(request.sourcePath));
  }

  return options;
}

function createExtensionRegistry(
  request: RenderRequest,
): ProcessorOptions['extension_registry'] {
  if (
    request.allowLocalIncludes !== true
    || request.sourcePath === undefined
    || request.sourcePath.length === 0
  ) {
    return undefined;
  }

  const rootPaths = request.allowedIncludeRootPaths === undefined
    || request.allowedIncludeRootPaths.length === 0
    ? [path.dirname(path.resolve(request.sourcePath))]
    : request.allowedIncludeRootPaths;
  return createSecureIncludeRegistry(asciidoctor, {
    allowedRootPaths: rootPaths,
    sourcePath: request.sourcePath,
  });
}

const ATTRIBUTE_CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F]/u;
const ATTRIBUTE_URI_SCHEME_PATTERN = /^[a-z][a-z\d+.-]*:/iu;

/**
 * 讀取已儲存文件的 AsciiDoc stylesheet 宣告，供本機預覽載入。
 *
 * Asciidoctor 的 embedded output 不會自行產生 stylesheet link，因此必須
 * 將 `stylesdir` 與 `stylesheet` 解析成候選檔案路徑，再由 PreviewSession
 * 依 workspace root、實體檔案與 Webview resource policy 做第二次檢查；
 * include 的信任條件不會因此被放寬。
 */
function resolveAsciiDocStylesheets(
  document: Document,
  request: RenderRequest,
): readonly string[] {
  if (
    request.sourcePath === undefined
    || request.sourcePath.length === 0
  ) {
    return [];
  }

  const stylesheet = readDocumentAttribute(document, 'stylesheet');
  if (stylesheet === undefined || !isSafeStylesheetAttribute(stylesheet)) {
    return [];
  }

  const stylesdir = readDocumentAttribute(document, 'stylesdir') ?? '.';
  if (!isSafeStylesheetAttribute(stylesdir)) {
    return [];
  }

  const sourceDirectory = path.dirname(path.resolve(request.sourcePath));
  return [path.resolve(sourceDirectory, stylesdir, stylesheet)];
}

function readDocumentAttribute(
  document: Document,
  attributeName: string,
): string | undefined {
  try {
    const getAttribute = Reflect.get(document, 'getAttribute') as unknown;
    if (typeof getAttribute !== 'function') {
      return undefined;
    }
    const value = Reflect.apply(
      getAttribute,
      document,
      [attributeName],
    ) as unknown;
    return typeof value === 'string' && value.trim().length > 0
      ? value.trim()
      : undefined;
  } catch {
    return undefined;
  }
}

function isSafeStylesheetAttribute(value: string): boolean {
  return value.length > 0
    && !ATTRIBUTE_CONTROL_CHARACTER_PATTERN.test(value)
    && !value.startsWith('//')
    && !ATTRIBUTE_URI_SCHEME_PATTERN.test(value)
    && !path.isAbsolute(value)
    && !path.win32.isAbsolute(value);
}

function addSourceLineRoles(document: Document): void {
  for (const block of document.findBy({})) {
    try {
      if (block.getContext() === 'document') {
        continue;
      }

      const sourceLine = getMainDocumentSourceLine(block);
      if (sourceLine !== undefined) {
        block.addRole(`${SOURCE_LINE_ROLE_PREFIX}${String(sourceLine)}`);
      }
    } catch {
      // 單一 AST 節點的 metadata 失效時，仍保留其他內容的預覽。
    }
  }
}

function getMainDocumentSourceLine(block: AbstractBlock): number | undefined {
  let sourceLocation: unknown;
  try {
    sourceLocation = block.getSourceLocation();
  } catch {
    return undefined;
  }

  const { lineNumber, sourceFile } = readSourceLocation(sourceLocation);

  if (lineNumber === undefined || sourceFile !== undefined) {
    return undefined;
  }

  return lineNumber - 1;
}

function replaceSourceLineRoles(html: string): string {
  return html.replace(
    CLASS_ATTRIBUTE_PATTERN,
    (attribute: string, quote: string, classNames: string): string => {
      const classes = classNames.split(/\s+/u).filter((className) => className.length > 0);
      const sourceLineRole = classes.find((className) => SOURCE_LINE_ROLE_PATTERN.test(className));
      if (sourceLineRole === undefined) {
        return attribute;
      }

      const sourceLine = SOURCE_LINE_ROLE_PATTERN.exec(sourceLineRole)?.[1];
      if (sourceLine === undefined) {
        return attribute;
      }

      const remainingClasses = classes.filter((className) => className !== sourceLineRole);
      const classAttribute = remainingClasses.length === 0
        ? ''
        : ` class=${quote}${remainingClasses.join(' ')}${quote}`;

      return ` ${SOURCE_LINE_ATTRIBUTE}="${sourceLine}"${classAttribute}`;
    },
  );
}

function addDocumentTitleSourceLine(html: string, sourceLine: number): string {
  return html.replace(
    /<h1(?=[\s>])/iu,
    `<h1 ${SOURCE_LINE_ATTRIBUTE}="${String(sourceLine)}"`,
  );
}

function getPlainDocumentTitle(document: Document): string | undefined {
  const title = document.getDocumentTitle({
    sanitize: true,
  });

  if (typeof title !== 'string' || title.length === 0) {
    return undefined;
  }

  return decodeCharacterReferences(title);
}

function decodeCharacterReferences(value: string): string {
  return value.replace(
    /&(?:#(\d+)|#x([\da-f]+)|(amp|apos|gt|lt|quot));/giu,
    (characterReference: string, decimal: string | undefined, hexadecimal: string | undefined, named: string | undefined): string => {
      if (decimal !== undefined) {
        return decodeCodePoint(Number.parseInt(decimal, 10), characterReference);
      }
      if (hexadecimal !== undefined) {
        return decodeCodePoint(Number.parseInt(hexadecimal, 16), characterReference);
      }

      switch (named?.toLowerCase()) {
        case 'amp':
          return '&';
        case 'apos':
          return "'";
        case 'gt':
          return '>';
        case 'lt':
          return '<';
        case 'quot':
          return '"';
        default:
          return characterReference;
      }
    },
  );
}

function decodeCodePoint(codePoint: number, fallback: string): string {
  return Number.isSafeInteger(codePoint)
    && codePoint >= 0
    && codePoint <= 0x10_FFFF
    && !(codePoint >= 0xD800 && codePoint <= 0xDFFF)
    ? String.fromCodePoint(codePoint)
    : fallback;
}
