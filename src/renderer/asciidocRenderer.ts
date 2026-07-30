import path from 'node:path';

import type {
  AbstractBlock,
  Document,
  LoggerMessage,
  ProcessorOptions,
} from '@asciidoctor/core';

import type { RenderRequest } from '../models/renderRequest';
import type { RenderMessage } from '../models/renderMessage';
import createAsciidoctorRuntime from './asciidoctorRuntime.cjs';

interface RenderedFragment {
  readonly html: string;
  readonly messages?: readonly RenderMessage[];
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
      ...(title === undefined ? {} : { title }),
    };
  } finally {
    asciidoctor.LoggerManager.setLogger(previousLogger);
  }
}

function toRenderMessage(loggerMessage: LoggerMessage): RenderMessage {
  const sourceLocation = loggerMessage.getSourceLocation();
  const lineNumber = readPositiveInteger(sourceLocation.getLineNumber());
  const sourceFile = readNonEmptyString(sourceLocation.getFile());
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

function createProcessorOptions(request: RenderRequest): ProcessorOptions {
  const options: ProcessorOptions = {
    attributes: {
      showtitle: true,
    },
    header_footer: false,
    safe: request.allowLocalIncludes === true
      ? 'safe'
      : 'secure',
    sourcemap: true,
  };

  if (request.sourcePath !== undefined && request.sourcePath.length > 0) {
    options.base_dir = path.dirname(path.resolve(request.sourcePath));
  }

  return options;
}

function addSourceLineRoles(document: Document): void {
  for (const block of document.findBy({})) {
    if (block.getContext() === 'document') {
      continue;
    }

    const sourceLine = getMainDocumentSourceLine(block);
    if (sourceLine !== undefined) {
      block.addRole(`${SOURCE_LINE_ROLE_PREFIX}${String(sourceLine)}`);
    }
  }
}

function getMainDocumentSourceLine(block: AbstractBlock): number | undefined {
  const sourceLocation = block.getSourceLocation();
  const lineNumber = sourceLocation.getLineNumber();
  const sourceFile = sourceLocation.getFile();

  if (lineNumber === undefined || lineNumber < 1 || sourceFile !== undefined) {
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
