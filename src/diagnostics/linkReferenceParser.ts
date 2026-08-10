import type {
  DocumentPosition,
  DocumentRange,
  DocumentReference,
} from '../models/documentAnalysis';
import type { DocumentKind } from '../models/documentKind';

export interface DocumentReferenceInput {
  readonly source: string;
  readonly kind: DocumentKind;
}

export interface ExplicitAnchorDefinition {
  readonly id: string;
  readonly range: DocumentRange;
}

/**
 * 只負責從原始文字找出可驗證的引用，不讀取檔案，也不依賴 VS Code。
 * Range 直接以來源行與字元計算，避免把 HTML 解析結果反推回來源位置。
 */
export function parseDocumentReferences(
  input: DocumentReferenceInput,
): readonly DocumentReference[] {
  const lines = input.source.split(/\r?\n/u);
  const references: DocumentReference[] = [];
  let fenced = false;
  let fenceMarker: string | undefined;

  lines.forEach((line, lineNumber): void => {
    const fence = detectFence(line, input.kind, fenceMarker);
    if (fence !== undefined) {
      if (fenceMarker === undefined) {
        fenceMarker = fence;
        fenced = true;
      } else if (fence === fenceMarker) {
        fenceMarker = undefined;
        fenced = false;
      }
      return;
    }

    if (fenced) {
      return;
    }

    if (input.kind === 'markdown') {
      parseMarkdownLine(line, lineNumber, references);
    } else {
      parseAsciiDocLine(line, lineNumber, references);
    }
  });

  return references;
}

/**
 * 取得文件明確宣告的 anchor。標題 anchor 由 outline parser 提供，這裡補上
 * `[[id]]`、`[#id]` 與 `anchor:id[]` 等不一定出現在 AST 標題上的形式。
 */
export function parseExplicitAnchors(
  source: string,
  kind: DocumentKind,
): ReadonlySet<string> {
  return new Set(
    parseExplicitAnchorDefinitions(source, kind).map(({ id }) => id),
  );
}

/** 取得明確 Anchor 的識別碼及可安全改名的精確來源範圍。 */
export function parseExplicitAnchorDefinitions(
  source: string,
  kind: DocumentKind,
): readonly ExplicitAnchorDefinition[] {
  const definitions: ExplicitAnchorDefinition[] = [];
  const lines = source.split(/\r?\n/u);
  let fenced = false;
  let fenceMarker: string | undefined;

  lines.forEach((line, lineNumber): void => {
    const fence = detectFence(line, kind, fenceMarker);
    if (fence !== undefined) {
      if (fenceMarker === undefined) {
        fenceMarker = fence;
        fenced = true;
      } else if (fence === fenceMarker) {
        fenceMarker = undefined;
        fenced = false;
      }
      return;
    }
    if (fenced) {
      return;
    }

    if (kind === 'markdown') {
      parseMarkdownAnchorDefinitions(line, lineNumber, definitions);
    } else {
      parseAsciiDocAnchorDefinitions(line, lineNumber, definitions);
    }
  });

  return definitions;
}

function parseMarkdownLine(
  line: string,
  lineNumber: number,
  references: DocumentReference[],
): void {
  const pattern = /(!?)\[[^\]\r\n]*\]\(\s*(<[^>\r\n]+>|[^)\s]+)(?:\s+[^)]*)?\s*\)/gu;
  for (const match of line.matchAll(pattern)) {
    const marker = match[1] ?? '';
    const rawTarget = match[2];
    if (rawTarget === undefined) {
      continue;
    }

    const enclosed = rawTarget.startsWith('<') && rawTarget.endsWith('>');
    const target = enclosed ? rawTarget.slice(1, -1) : rawTarget;
    const matchIndex = match.index;
    const rawTargetOffset = line.indexOf(rawTarget, matchIndex);
    const targetOffset = rawTargetOffset < 0
      ? matchIndex
      : rawTargetOffset + (enclosed ? 1 : 0);
    references.push({
      kind: marker === '!' ? 'image' : 'link',
      target,
      range: createRange(lineNumber, targetOffset, target.length),
    });
  }
}

function parseAsciiDocLine(
  line: string,
  lineNumber: number,
  references: DocumentReference[],
): void {
  const macroPattern = /\b(include|image)::([^\s\[]+)\s*\[/gu;
  for (const match of line.matchAll(macroPattern)) {
    const kind = match[1];
    const target = match[2];
    if (!isReferenceKind(kind) || target === undefined) {
      continue;
    }
    const matchIndex = match.index;
    const targetOffset = line.indexOf(target, matchIndex);
    references.push({
      kind,
      target,
      range: createRange(lineNumber, Math.max(0, targetOffset), target.length),
    });
  }

  const linkPattern = /\blink:([^\s\[]+)\s*\[/gu;
  for (const match of line.matchAll(linkPattern)) {
    const target = match[1];
    if (target === undefined) {
      continue;
    }
    const matchIndex = match.index;
    const targetOffset = line.indexOf(target, matchIndex);
    references.push({
      kind: 'link',
      target,
      range: createRange(lineNumber, Math.max(0, targetOffset), target.length),
    });
  }

  const inlineImagePattern = /\bimage:(?!:)([^\s\[]+)\s*\[/gu;
  for (const match of line.matchAll(inlineImagePattern)) {
    const target = match[1];
    if (target === undefined) {
      continue;
    }
    const matchIndex = match.index;
    const targetOffset = line.indexOf(target, matchIndex);
    references.push({
      kind: 'image',
      target,
      range: createRange(lineNumber, Math.max(0, targetOffset), target.length),
    });
  }

  const xrefPattern = /\bxref:([^\s\[]+)\s*\[/gu;
  for (const match of line.matchAll(xrefPattern)) {
    const target = match[1];
    if (target === undefined) {
      continue;
    }
    const matchIndex = match.index;
    const targetOffset = line.indexOf(target, matchIndex);
    references.push({
      kind: 'xref',
      target,
      range: createRange(lineNumber, Math.max(0, targetOffset), target.length),
    });
  }

  const shorthandPattern = /<<([^,>\s]+)(?:,[^>]*)?>>/gu;
  for (const match of line.matchAll(shorthandPattern)) {
    const rawTarget = match[1];
    if (rawTarget === undefined) {
      continue;
    }
    const matchIndex = match.index;
    const targetOffset = line.indexOf(rawTarget, matchIndex);
    references.push({
      kind: 'xref',
      target: rawTarget.includes('#') ? rawTarget : `#${rawTarget}`,
      range: createRange(
        lineNumber,
        Math.max(0, targetOffset),
        rawTarget.length,
      ),
    });
  }
}

function parseMarkdownAnchorDefinitions(
  line: string,
  lineNumber: number,
  definitions: ExplicitAnchorDefinition[],
): void {
  const explicitPattern = /\{#([^}\s]+)\}/gu;
  for (const match of line.matchAll(explicitPattern)) {
    const anchor = match[1];
    addAnchorDefinition(definitions, line, lineNumber, match, anchor);
  }
}

function parseAsciiDocAnchorDefinitions(
  line: string,
  lineNumber: number,
  definitions: ExplicitAnchorDefinition[],
): void {
  const blockPattern = /\[\[([^,\]\s]+)(?:,[^\]]*)?\]\]/gu;
  const stylePattern = /\[#([^\]\s]+)\]/gu;
  const macroPattern = /\banchor:([^\s\[]+)\s*\[/gu;

  for (const match of line.matchAll(blockPattern)) {
    addAnchorDefinition(definitions, line, lineNumber, match, match[1]);
  }
  for (const match of line.matchAll(stylePattern)) {
    addAnchorDefinition(definitions, line, lineNumber, match, match[1]);
  }
  for (const match of line.matchAll(macroPattern)) {
    addAnchorDefinition(definitions, line, lineNumber, match, match[1]);
  }
}

function addAnchorDefinition(
  definitions: ExplicitAnchorDefinition[],
  line: string,
  lineNumber: number,
  match: RegExpMatchArray,
  value: string | undefined,
): void {
  if (value === undefined || value.length === 0) {
    return;
  }
  const character = line.indexOf(value, match.index);
  definitions.push({
    id: value,
    range: createRange(
      lineNumber,
      Math.max(0, character),
      value.length,
    ),
  });
}

function detectFence(
  line: string,
  kind: DocumentKind,
  activeMarker: string | undefined,
): string | undefined {
  if (kind === 'markdown') {
    const match = /^\s{0,3}(`{3,}|~{3,})/u.exec(line);
    if (match === null) {
      return undefined;
    }
    const marker = match[1];
    if (marker === undefined) {
      return undefined;
    }
    const markerKind = marker[0];
    if (markerKind === undefined) {
      return undefined;
    }
    if (activeMarker !== undefined && !activeMarker.startsWith(markerKind)) {
      return undefined;
    }
    return markerKind;
  }

  if (/^\s*(----|\.\.\.\.)\s*$/u.test(line)) {
    return 'asciidoc-block';
  }
  return undefined;
}

function isReferenceKind(value: string | undefined): value is 'link' | 'xref' | 'image' | 'include' {
  return value === 'xref' || value === 'include' || value === 'image' || value === 'link';
}

function createRange(
  line: number,
  character: number,
  length: number,
): DocumentRange {
  const start: DocumentPosition = { line, character };
  const end: DocumentPosition = { line, character: character + length };
  return { start, end };
}
