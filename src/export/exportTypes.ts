import type { DocumentKind } from '../models/documentKind';
import type { RenderRequest } from '../models/renderRequest';
import type { RenderResult } from '../models/renderResult';

/** 可由命令輸出的三種 HTML 形態。 */
export type ExportFormat = 'html' | 'standalone-html' | 'embedded-html';

export interface ExportInput {
  readonly kind: DocumentKind;
  readonly source: string;
  readonly sourcePath?: string;
  readonly workspaceRootPath?: string;
  readonly workspaceTrusted: boolean;
  readonly format: ExportFormat;
  readonly destinationPath?: string;
  /** 已由 UI 明確確認覆寫時才傳入 true。 */
  readonly overwrite?: boolean;
}

export interface ExportOutput {
  readonly content: string;
  readonly destinationPath?: string;
  readonly title?: string;
}

export type ExportRenderer = (
  request: RenderRequest,
  signal?: AbortSignal,
) => Promise<RenderResult>;

export interface ExportFileStat {
  readonly type: 'file' | 'directory' | 'unknown';
}

/** ExportService 使用的最小檔案系統介面，方便在 Node 單元測試注入替身。 */
export interface ExportFileSystem {
  readonly readFile: (filePath: string) => Promise<Uint8Array>;
  readonly writeFile: (filePath: string, data: Uint8Array) => Promise<void>;
  readonly createDirectory: (directoryPath: string) => Promise<void>;
  readonly stat: (filePath: string) => Promise<ExportFileStat>;
}

export interface ExportFileMimeType {
  readonly extension: string;
  readonly mimeType: string;
}
