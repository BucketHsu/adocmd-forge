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
  const anchors = new Set<string>();
  const lines = source.split(/\r?\n/u);
  let fenced = false;
  let fenceMarker: string | undefined;

  lines.forEach((line): void => {
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
      parseMarkdownAnchors(line, anchors);
    } else {
      parseAsciiDocAnchors(line, anchors);
    }
  });

  return anchors;
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
}

function parseMarkdownAnchors(line: string, anchors: Set<string>): void {
  const explicitPattern = /\{#([^}\s]+)\}/gu;
  for (const match of line.matchAll(explicitPattern)) {
    const anchor = match[1];
    if (anchor !== undefined && anchor.length > 0) {
      anchors.add(anchor);
    }
  }
}

function parseAsciiDocAnchors(line: string, anchors: Set<string>): void {
  const blockPattern = /\[\[([^,\]\s]+)(?:,[^\]]*)?\]\]/gu;
  const stylePattern = /\[#([^\]\s]+)\]/gu;
  const macroPattern = /\banchor:([^\s\[]+)\s*\[/gu;

  for (const match of line.matchAll(blockPattern)) {
    addAnchor(anchors, match[1]);
  }
  for (const match of line.matchAll(stylePattern)) {
    addAnchor(anchors, match[1]);
  }
  for (const match of line.matchAll(macroPattern)) {
    addAnchor(anchors, match[1]);
  }
}

function addAnchor(anchors: Set<string>, value: string | undefined): void {
  if (value !== undefined && value.length > 0) {
    anchors.add(value);
  }
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
  return value === 'xref' || value === 'include' || value === 'image';
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
