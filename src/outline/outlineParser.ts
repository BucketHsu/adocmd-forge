import type {
  Document as AsciiDocDocument,
  ProcessorOptions,
  Section as AsciiDocSection,
} from '@asciidoctor/core';
import MarkdownIt from 'markdown-it';

import type {
  DocumentAnalysis,
  DocumentPosition,
  DocumentRange,
  Heading,
  OutlineNode,
} from '../models/documentAnalysis';
import type { DocumentKind } from '../models/documentKind';
import createAsciidoctorRuntime from '../renderer/asciidoctorRuntime.cjs';
import { parseDocumentReferences } from '../diagnostics/linkReferenceParser';

export interface DocumentAnalysisInput {
  readonly documentUri: string;
  readonly kind: DocumentKind;
  readonly source: string;
  readonly version?: number;
  readonly sourcePath?: string;
}

const markdown = new MarkdownIt({
  html: false,
  linkify: false,
  typographer: false,
});
type MarkdownToken = ReturnType<typeof markdown.parse>[number];

const asciidoctor = createAsciidoctorRuntime();

export interface AsciiDocProcessor {
  load(input: string, options?: ProcessorOptions): AsciiDocDocument;
}

/**
 * 以正式 parser 產生文件分析結果。
 * 這個模組刻意不依賴 vscode，供 Outline 與後續 Link Checker 共用。
 */
export function analyzeDocument(input: DocumentAnalysisInput): DocumentAnalysis {
  return input.kind === 'markdown'
    ? parseMarkdownOutline(input)
    : parseAsciiDocOutline(input);
}

export function parseMarkdownOutline(
  input: Omit<DocumentAnalysisInput, 'kind'>,
): DocumentAnalysis {
  const version = input.version ?? 0;
  const documentInput: DocumentAnalysisInput = {
    ...input,
    kind: 'markdown',
  };

  try {
    const environment: Record<string, unknown> = {};
    const tokens = markdown.parse(input.source, environment);
    const lines = input.source.split(/\r?\n/u);
    const headings: Heading[] = [];
    const anchors = new Set<string>();
    const anchorOccurrences = new Map<string, number>();

    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index];
      if (token?.type !== 'heading_open' || token.map === null) {
        continue;
      }

      const inlineToken = tokens[index + 1];
      const title = inlineToken?.type === 'inline'
        ? collectMarkdownInlineText(inlineToken.children)
        : '';
      const normalizedTitle = title.trim();
      const level = parseMarkdownHeadingLevel(token.tag);
      if (normalizedTitle.length === 0 || level === undefined) {
        continue;
      }

      const startLine = token.map[0];
      const endLine = Math.max(startLine, token.map[1] - 1);
      const anchorBase = createMarkdownAnchor(normalizedTitle);
      const occurrence = anchorOccurrences.get(anchorBase) ?? 0;
      anchorOccurrences.set(anchorBase, occurrence + 1);
      const anchor = occurrence === 0
        ? anchorBase
        : `${anchorBase}-${String(occurrence)}`;
      anchors.add(anchor);

      headings.push({
        id: createHeadingId(input.documentUri, startLine, level),
        documentUri: input.documentUri,
        title: normalizedTitle,
        level,
        sourceLine: startLine,
        line: startLine,
        range: createRange(lines, startLine, endLine),
        anchor,
      });
    }

    return createAnalysis(documentInput, version, headings, anchors);
  } catch (error) {
    return createAnalysisError(documentInput, version, error);
  }
}

export function parseAsciiDocOutline(
  input: Omit<DocumentAnalysisInput, 'kind'>,
  processor: AsciiDocProcessor = asciidoctor,
): DocumentAnalysis {
  const version = input.version ?? 0;
  const documentInput: DocumentAnalysisInput = {
    ...input,
    kind: 'asciidoc',
  };

  try {
    const document = processor.load(
      input.source,
      createAsciiDocOptions(input.sourcePath),
    );
    const lines = input.source.split(/\r?\n/u);
    const headings: Heading[] = [];
    const anchors = new Set<string>();

    addAsciiDocDocumentTitle(document, documentInput, lines, headings, anchors);
    collectAsciiDocSections(document, documentInput, lines, headings, anchors);

    return createAnalysis(documentInput, version, headings, anchors);
  } catch (error) {
    return createAnalysisError(documentInput, version, error);
  }
}

export function createHeadingId(
  documentUri: string,
  sourceLine: number,
  level: number,
): string {
  return `adocmd-forge:${encodeURIComponent(documentUri)}:${String(sourceLine)}:${String(level)}`;
}

function createAnalysis(
  input: DocumentAnalysisInput,
  version: number,
  headings: readonly Heading[],
  anchors: ReadonlySet<string>,
): DocumentAnalysis {
  return {
    documentUri: input.documentUri,
    version,
    kind: input.kind,
    headings,
    outline: createOutline(headings),
    anchors,
    references: parseDocumentReferences({
      source: input.source,
      kind: input.kind,
    }),
  };
}

function createAnalysisError(
  input: DocumentAnalysisInput,
  version: number,
  error: unknown,
): DocumentAnalysis {
  return {
    documentUri: input.documentUri,
    version,
    kind: input.kind,
    headings: [],
    outline: [],
    anchors: new Set<string>(),
    references: parseDocumentReferences({
      source: input.source,
      kind: input.kind,
    }),
    error: getErrorMessage(error),
  };
}

function createOutline(headings: readonly Heading[]): readonly OutlineNode[] {
  interface MutableNode {
    readonly heading: Heading;
    readonly children: MutableNode[];
  }

  const roots: MutableNode[] = [];
  const parents: MutableNode[] = [];

  for (const heading of headings) {
    while (
      parents.length > 0
      && (parents.at(-1)?.heading.level ?? 0) >= heading.level
    ) {
      parents.pop();
    }

    const node: MutableNode = {
      heading,
      children: [],
    };
    const parent = parents.at(-1);
    if (parent === undefined) {
      roots.push(node);
    } else {
      parent.children.push(node);
    }
    parents.push(node);
  }

  const freeze = (node: MutableNode): OutlineNode => ({
    ...node.heading,
    children: node.children.map(freeze),
  });
  return roots.map(freeze);
}

function addAsciiDocDocumentTitle(
  document: AsciiDocDocument,
  input: DocumentAnalysisInput,
  lines: readonly string[],
  headings: Heading[],
  anchors: Set<string>,
): void {
  const header = readHeader(document);
  const title = readNodeTitle(header);
  if (title === undefined) {
    return;
  }

  const sourceLine = readNodeSourceLine(header) ?? findAsciiDocDocumentTitleLine(lines);
  if (sourceLine === undefined) {
    return;
  }

  const anchor = createAsciiDocAnchor(title);
  const heading: Heading = {
    id: createHeadingId(input.documentUri, sourceLine, 0),
    documentUri: input.documentUri,
    title,
    level: 0,
    sourceLine,
    line: sourceLine,
    range: createRange(lines, sourceLine),
    ...(anchor.length > 0 ? { anchor } : {}),
  };
  headings.push(heading);
  if (anchor.length > 0) {
    anchors.add(anchor);
  }
}

function collectAsciiDocSections(
  document: AsciiDocDocument,
  input: DocumentAnalysisInput,
  lines: readonly string[],
  headings: Heading[],
  anchors: Set<string>,
): void {
  const visit = (sections: readonly AsciiDocSection[]): void => {
    for (const section of sections) {
      const title = readNodeTitle(section);
      const level = readNodeLevel(section);
      const sourceLine = readNodeSourceLine(section);
      if (title !== undefined && level !== undefined && sourceLine !== undefined) {
        const id = readNodeId(section);
        const anchor = id ?? createAsciiDocAnchor(title);
        headings.push({
          id: createHeadingId(input.documentUri, sourceLine, level),
          documentUri: input.documentUri,
          title,
          level,
          sourceLine,
          line: sourceLine,
          range: createRange(lines, sourceLine),
          ...(anchor.length > 0 ? { anchor } : {}),
        });
        if (anchor.length > 0) {
          anchors.add(anchor);
        }
      }

      const children = readNodeSections(section);
      if (children.length > 0) {
        visit(children);
      }
    }
  };

  visit(readNodeSections(document));
}

function createAsciiDocOptions(sourcePath: string | undefined): Record<string, unknown> {
  const options: Record<string, unknown> = {
    header_footer: false,
    safe: 'secure',
    sourcemap: true,
  };
  if (sourcePath !== undefined && sourcePath.length > 0) {
    options.base_dir = sourcePath;
  }
  return options;
}

function readHeader(document: AsciiDocDocument): unknown {
  try {
    return document.getHeader();
  } catch {
    return undefined;
  }
}

function readNodeSections(value: unknown): readonly AsciiDocSection[] {
  if (!isObjectLike(value)) {
    return [];
  }
  try {
    const getter = readMethod(value, 'getSections');
    if (getter === undefined) {
      return [];
    }
    const sections = getter();
    return Array.isArray(sections)
      ? sections.filter(isAsciiDocSection)
      : [];
  } catch {
    return [];
  }
}

function isAsciiDocSection(value: unknown): value is AsciiDocSection {
  return isObjectLike(value)
    && readMethod(value, 'getTitle') !== undefined
    && readMethod(value, 'getLevel') !== undefined;
}

function readNodeTitle(value: unknown): string | undefined {
  if (!isObjectLike(value)) {
    return undefined;
  }
  try {
    const getter = readMethod(value, 'getTitle');
    if (getter === undefined) {
      return undefined;
    }
    const title = getter();
    if (typeof title !== 'string') {
      return undefined;
    }
    const plainTitle = stripMarkup(title).trim();
    return plainTitle.length === 0 ? undefined : plainTitle;
  } catch {
    return undefined;
  }
}

function readNodeLevel(value: unknown): number | undefined {
  if (!isObjectLike(value)) {
    return undefined;
  }
  try {
    const getter = readMethod(value, 'getLevel');
    const level = getter?.();
    return typeof level === 'number'
      && Number.isSafeInteger(level)
      && level >= 1
      ? level
      : undefined;
  } catch {
    return undefined;
  }
}

function readNodeSourceLine(value: unknown): number | undefined {
  if (!isObjectLike(value)) {
    return undefined;
  }
  try {
    const locationGetter = readMethod(value, 'getSourceLocation');
    if (locationGetter === undefined) {
      return undefined;
    }
    const location = locationGetter();
    if (!isObjectLike(location)) {
      return undefined;
    }
    const lineGetter = readMethod(location, 'getLineNumber');
    const line = lineGetter?.();
    return typeof line === 'number'
      && Number.isSafeInteger(line)
      && line >= 1
      ? line - 1
      : undefined;
  } catch {
    return undefined;
  }
}

function readNodeId(value: unknown): string | undefined {
  if (!isObjectLike(value)) {
    return undefined;
  }
  try {
    const getter = readMethod(value, 'getId');
    const id = getter?.();
    return typeof id === 'string' && id.length > 0 ? id : undefined;
  } catch {
    return undefined;
  }
}

function findAsciiDocDocumentTitleLine(lines: readonly string[]): number | undefined {
  const firstLine = lines[0];
  return firstLine !== undefined && /^=\s+\S/u.test(firstLine) ? 0 : undefined;
}

function parseMarkdownHeadingLevel(tag: string): number | undefined {
  const match = /^h([1-6])$/u.exec(tag);
  if (match === null) {
    return undefined;
  }
  const level = Number.parseInt(match[1] ?? '', 10);
  return Number.isSafeInteger(level) ? level : undefined;
}

function collectMarkdownInlineText(
  tokens: readonly MarkdownToken[] | null | undefined,
): string {
  if (tokens === null || tokens === undefined) {
    return '';
  }

  return tokens.map((token) => {
    if (token.type === 'text' || token.type === 'code_inline' || token.type === 'image') {
      return token.content;
    }
    if (token.type === 'softbreak' || token.type === 'hardbreak') {
      return ' ';
    }
    return collectMarkdownInlineText(token.children);
  }).join('');
}

function createMarkdownAnchor(title: string): string {
  const normalized = title
    .normalize('NFKD')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .trim()
    .replace(/[\s_-]+/gu, '-');
  return normalized.length > 0 ? normalized : 'heading';
}

function createAsciiDocAnchor(title: string): string {
  return title
    .toLocaleLowerCase()
    .replace(/<[^>]*>/gu, '')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .trim()
    .replace(/[\s_-]+/gu, '_');
}

function stripMarkup(value: string): string {
  return decodeCharacterReferences(value.replace(/<[^>]*>/gu, ''));
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
        case 'amp': return '&';
        case 'apos': return "'";
        case 'gt': return '>';
        case 'lt': return '<';
        case 'quot': return '"';
        default: return characterReference;
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

function createRange(
  lines: readonly string[],
  startLine: number,
  endLine = startLine,
): DocumentRange {
  const safeStartLine = clampLine(lines, startLine);
  const safeEndLine = Math.max(safeStartLine, clampLine(lines, endLine));
  const endText = lines[safeEndLine] ?? '';
  const start: DocumentPosition = {
    line: safeStartLine,
    character: 0,
  };
  const end: DocumentPosition = {
    line: safeEndLine,
    character: endText.length,
  };
  return { start, end };
}

function clampLine(lines: readonly string[], line: number): number {
  if (lines.length === 0) {
    return 0;
  }
  return Math.min(Math.max(0, line), lines.length - 1);
}

function isObjectLike(value: unknown): value is object {
  return value !== null && (typeof value === 'object' || typeof value === 'function');
}

function readMethod(value: object, name: string): (() => unknown) | undefined {
  const candidate: unknown = Reflect.get(value, name);
  return typeof candidate === 'function'
    ? (): unknown => Reflect.apply(candidate, value, [])
    : undefined;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error && error.message.length > 0
    ? error.message
    : String(error);
}
