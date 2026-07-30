/**
 * VS Code 中已開啟文件的不可變內容快照。
 *
 * `path` 必須是 Extension Host 可存取的絕對檔案路徑。
 */
export interface OpenDocumentSnapshot {
  readonly path: string;
  readonly text: string;
  readonly version: number;
}

export interface LocalIncludeSnapshot {
  /**
   * include 只能解析到這些目錄內。呼叫端必須先確認工作區已受信任。
   */
  readonly allowedRootPaths: readonly string[];
  readonly openDocuments: readonly OpenDocumentSnapshot[];
}

export type IncludeDependencyState = 'loaded' | 'missing';

/**
 * 實際處理過的 include 相依檔案。
 *
 * `requestedPath` 保留 AsciiDoc 的字面解析位置，供檔案監聽使用；
 * `canonicalPath` 僅在目標通過實體路徑邊界檢查後提供。
 */
export interface IncludeDependency {
  readonly canonicalPath?: string;
  readonly requestedPath: string;
  readonly state: IncludeDependencyState;
}

export type IncludeContentSource = 'file-system' | 'open-document';

export interface LoadedInclude {
  readonly content: string;
  readonly dependency: IncludeDependency & {
    readonly canonicalPath: string;
    readonly state: 'loaded';
  };
  readonly kind: 'loaded';
  readonly snapshotVersion?: number;
  readonly source: IncludeContentSource;
}

export interface MissingInclude {
  readonly dependency: IncludeDependency & {
    readonly state: 'missing';
  };
  readonly kind: 'missing';
  readonly optional: boolean;
}

export type RejectedIncludeReason =
  | 'absolute-target'
  | 'external-target'
  | 'invalid-target'
  | 'not-file'
  | 'outside-root'
  | 'unreadable';

export interface RejectedInclude {
  readonly kind: 'rejected';
  readonly reason: RejectedIncludeReason;
  readonly target: string;
}

export type IncludeResolution =
  | LoadedInclude
  | MissingInclude
  | RejectedInclude;

export interface IncludeLoadRequest {
  /**
   * 目前含有 include 指令的檔案。巢狀 include 必須傳入上一層的字面路徑。
   */
  readonly includingFilePath: string;
  readonly optional?: boolean;
  /**
   * Asciidoctor 完成 attribute substitution 後交給 IncludeProcessor 的目標。
   */
  readonly target: string;
}

export interface IncludeSelectionIssue {
  readonly code:
    | 'mismatched-end-tag'
    | 'missing-tag'
    | 'unclosed-tag'
    | 'unexpected-end-tag';
  readonly expectedTag?: string;
  readonly line?: number;
  readonly tag: string;
}

export interface IncludeSelection {
  /**
   * 可直接傳給 `Reader.pushInclude`。未篩選時保留原字串，避免改變換行語意。
   */
  readonly data: string | string[];
  readonly filtered: boolean;
  readonly firstLine: number;
  readonly issues: readonly IncludeSelectionIssue[];
}

