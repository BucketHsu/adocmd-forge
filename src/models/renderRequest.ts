import type { DocumentKind } from './documentKind';

/**
 * 文件轉譯所需的純資料，不依賴 VS Code API。
 */
export interface RenderRequest {
  /**
   * 僅能由已信任工作區的 Extension Host adapter 開啟本機 include。
   * 文件層級 stylesheet 不受此旗標限制，會由預覽資源邊界另外驗證。
   */
  readonly allowLocalIncludes?: boolean;
  /**
   * AsciiDoc include 可讀取的 canonical root 候選；只接受 workspace 內的目錄。
   * 未提供時，renderer 會退回以 sourcePath 所在目錄作為唯一候選。
   */
  readonly allowedIncludeRootPaths?: readonly string[];
  readonly kind: DocumentKind;
  readonly source: string;
  /**
   * 原始文件的絕對路徑。AsciiDoc 會以所在目錄解析相對 include。
   */
  readonly sourcePath?: string;
}
