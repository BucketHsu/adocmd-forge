import type { DocumentAnalysis } from '../models/documentAnalysis';
import {
  analyzeDocument,
  type DocumentAnalysisInput,
} from '../outline/outlineParser';

/**
 * 文件分析的應用服務邊界。
 * Parser 維持純 Node；Outline、Diagnostics 等 adapter 透過此服務共用結果格式。
 */
export class DocumentAnalysisService {
  public analyze(input: DocumentAnalysisInput): DocumentAnalysis {
    return analyzeDocument(input);
  }
}
