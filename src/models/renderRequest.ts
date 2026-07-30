import type { DocumentKind } from './documentKind';

/**
 * 文件轉譯所需的純資料，不依賴 VS Code API。
 */
export interface RenderRequest {
  /**
   * 僅能由已信任工作區的 Extension Host adapter 開啟。
   */
  readonly allowLocalIncludes?: boolean;
  readonly kind: DocumentKind;
  readonly source: string;
  /**
   * 原始文件的絕對路徑。AsciiDoc 會以所在目錄解析相對 include。
   */
  readonly sourcePath?: string;
}
