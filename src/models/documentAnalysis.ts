import type { DocumentKind } from './documentKind';

/**
 * 不依賴 VS Code API 的文件位置。
 * 行號與字元位置均從零開始，與 TextDocument.positionAt() 一致。
 */
export interface DocumentPosition {
  readonly line: number;
  readonly character: number;
}

/** 文件語法元素在來源文件中的範圍。 */
export interface DocumentRange {
  readonly start: DocumentPosition;
  readonly end: DocumentPosition;
}

/** 文件標題或章節標題。 */
export interface Heading {
  /** 由文件 URI、來源行與層級產生的穩定識別碼。 */
  readonly id: string;
  /** VS Code Uri.toString() 形式的來源 URI。 */
  readonly documentUri: string;
  readonly title: string;
  /** AsciiDoc 文件標題為 0，Markdown h1 至 h6 為 1 至 6。 */
  readonly level: number;
  /** 標題起始行，從零開始。 */
  readonly sourceLine: number;
  /** sourceLine 的易讀別名，仍維持零起算。 */
  readonly line: number;
  readonly range: DocumentRange;
  /** 可供之後 Link Checker 使用的文件內 anchor。 */
  readonly anchor?: string;
}

/** Outline 樹中的節點。 */
export interface OutlineNode extends Heading {
  readonly children: readonly OutlineNode[];
}

/**
 * 文件引用的共用資料邊界。
 * 0.3.0 只建立模型；實際引用解析由後續 Link Checker 提供。
 */
export interface DocumentReference {
  readonly kind: 'link' | 'xref' | 'image' | 'include';
  readonly target: string;
  readonly range: DocumentRange;
}

/** Renderer、Outline 與後續 Link Checker 共用的文件分析結果。 */
export interface DocumentAnalysis {
  readonly documentUri: string;
  readonly version: number;
  readonly kind: DocumentKind;
  readonly headings: readonly Heading[];
  readonly outline: readonly OutlineNode[];
  readonly anchors: ReadonlySet<string>;
  readonly references: readonly DocumentReference[];
  /** Parser 失敗時提供可顯示給使用者的錯誤；不以假節點取代失敗結果。 */
  readonly error?: string;
}
