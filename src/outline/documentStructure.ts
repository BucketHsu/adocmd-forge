import type {
  DocumentAnalysis,
  DocumentRange,
  Heading,
  OutlineNode,
} from '../models/documentAnalysis';

export interface DocumentSection {
  readonly anchor?: string;
  readonly children: readonly DocumentSection[];
  readonly level: number;
  readonly range: DocumentRange;
  readonly selectionRange: DocumentRange;
  readonly title: string;
}

export interface DocumentFoldingRange {
  readonly endLine: number;
  readonly kind: 'comment' | 'region';
  readonly startLine: number;
}

/**
 * 將共用 Outline 分析結果轉成 VS Code 原生文件符號需要的完整章節範圍。
 * 標題的 selection range 只包含標題行，章節 range 則延伸到下一個同層或
 * 上層標題之前，讓 Breadcrumb、Outline 與折疊使用一致的結構。
 */
export function createDocumentSections(
  analysis: DocumentAnalysis,
  source: string,
): readonly DocumentSection[] {
  const lines = splitLines(source);
  const ranges = new Map<string, DocumentRange>();

  analysis.headings.forEach((heading, index): void => {
    const nextHeading = analysis.headings.slice(index + 1).find(
      ({ level }) => level <= heading.level,
    );
    const lastLine = Math.max(
      heading.sourceLine,
      nextHeading === undefined
        ? lines.length - 1
        : nextHeading.sourceLine - 1,
    );
    ranges.set(heading.id, {
      start: heading.range.start,
      end: {
        line: lastLine,
        character: lines[lastLine]?.length ?? 0,
      },
    });
  });

  const convert = (node: OutlineNode): DocumentSection => ({
    title: node.title,
    level: node.level,
    range: ranges.get(node.id) ?? node.range,
    selectionRange: node.range,
    ...(node.anchor === undefined ? {} : { anchor: node.anchor }),
    children: node.children.map(convert),
  });

  return analysis.outline.map(convert);
}

/** 建立章節與 AsciiDoc delimited block 的原生折疊範圍。 */
export function createAsciiDocFoldingRanges(
  analysis: DocumentAnalysis,
  source: string,
): readonly DocumentFoldingRange[] {
  const sectionRanges = createSectionFoldingRanges(analysis, source);
  const blockRanges = createDelimitedBlockFoldingRanges(source);
  const seen = new Set<string>();

  return [...sectionRanges, ...blockRanges]
    .filter((range) => {
      const key = `${String(range.startLine)}:${String(range.endLine)}:${range.kind}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .sort((left, right) => (
      left.startLine - right.startLine || right.endLine - left.endLine
    ));
}

function createSectionFoldingRanges(
  analysis: DocumentAnalysis,
  source: string,
): DocumentFoldingRange[] {
  const sectionByHeading = new Map<string, DocumentSection>();
  const collect = (
    nodes: readonly OutlineNode[],
    sections: readonly DocumentSection[],
  ): void => {
    nodes.forEach((node, index): void => {
      const section = sections[index];
      if (section === undefined) {
        return;
      }
      sectionByHeading.set(node.id, section);
      collect(node.children, section.children);
    });
  };
  collect(analysis.outline, createDocumentSections(analysis, source));

  return analysis.headings.flatMap((heading): DocumentFoldingRange[] => {
    const section = sectionByHeading.get(heading.id);
    if (
      section === undefined
      || section.range.end.line <= heading.sourceLine
    ) {
      return [];
    }
    return [{
      startLine: heading.sourceLine,
      endLine: section.range.end.line,
      kind: 'region',
    }];
  });
}

function createDelimitedBlockFoldingRanges(
  source: string,
): DocumentFoldingRange[] {
  interface OpenBlock {
    readonly marker: string;
    readonly startLine: number;
  }

  const ranges: DocumentFoldingRange[] = [];
  const stack: OpenBlock[] = [];
  splitLines(source).forEach((line, lineNumber): void => {
    const marker = readDelimiter(line);
    if (marker === undefined) {
      return;
    }
    const openBlock = stack.at(-1);
    if (openBlock?.marker === marker) {
      stack.pop();
      if (lineNumber > openBlock.startLine) {
        ranges.push({
          startLine: openBlock.startLine,
          endLine: lineNumber,
          kind: marker === '////' ? 'comment' : 'region',
        });
      }
      return;
    }
    stack.push({ marker, startLine: lineNumber });
  });
  return ranges;
}

function readDelimiter(line: string): string | undefined {
  const marker = line.trim();
  return DELIMITED_BLOCK_MARKERS.has(marker) ? marker : undefined;
}

function splitLines(source: string): readonly string[] {
  return source.split(/\r\n|[\n\r]/u);
}

const DELIMITED_BLOCK_MARKERS = new Set([
  '----',
  '....',
  '====',
  '****',
  '____',
  '////',
  '++++',
  '--',
  '|===',
]);

export function findHeadingAtLine(
  headings: readonly Heading[],
  line: number,
): Heading | undefined {
  return headings.find(({ range }) => (
    line >= range.start.line && line <= range.end.line
  ));
}
