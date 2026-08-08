import type {
  DocumentAnalysis,
  DocumentRange,
  DocumentReference,
} from '../models/documentAnalysis';
import type { DocumentKind } from '../models/documentKind';
import { analyzeDocument } from '../outline/outlineParser';
import {
  parseExplicitAnchors,
  parseDocumentReferences,
} from './linkReferenceParser';
import {
  pathsEqual,
  resolveLinkTarget,
  type ResolvedLinkTarget,
} from './linkPathPolicy';

export const LINK_DIAGNOSTIC_SOURCE = 'AdocMD Forge';

export type LinkDiagnosticSeverity = 'error' | 'warning' | 'information';

export interface LinkDiagnostic {
  readonly message: string;
  readonly code: LinkDiagnosticCode;
  readonly severity: LinkDiagnosticSeverity;
  readonly range: DocumentRange;
  readonly reference: DocumentReference;
}

export type LinkDiagnosticCode =
  | 'missing-file'
  | 'missing-anchor'
  | 'unsafe-path'
  | 'read-error'
  | 'parse-error';

export interface LinkCheckInput {
  readonly documentUri: string;
  readonly source: string;
  readonly kind: DocumentKind;
  readonly version?: number;
  readonly sourcePath?: string;
  readonly workspaceRoots?: readonly string[];
  readonly workspaceTrusted?: boolean;
}

export interface LinkCheckFileSystem {
  stat(filePath: string): Promise<LinkFileType>;
  readFile(filePath: string): Promise<string>;
}

export type LinkFileType = 'file' | 'directory' | 'unknown';

export class LinkCheckCancelledError extends Error {
  public constructor() {
    super('Link Checker 工作已取消。');
    this.name = 'LinkCheckCancelledError';
  }
}

/**
 * Link Checker 核心服務。它只透過注入的唯讀檔案系統取得檔案，沒有網路請求，
 * 因此同一套規則可以在 Node 單元測試與 VS Code Extension Host 使用。
 */
export class LinkCheckerService {
  public constructor(private readonly fileSystem: LinkCheckFileSystem) {}

  public async check(
    input: LinkCheckInput,
    signal?: AbortSignal,
  ): Promise<readonly LinkDiagnostic[]> {
    throwIfCancelled(signal);
    const analysis = analyzeDocument({
      documentUri: input.documentUri,
      kind: input.kind,
      source: input.source,
      ...(input.version === undefined ? {} : { version: input.version }),
      ...(input.sourcePath === undefined ? {} : { sourcePath: input.sourcePath }),
    });
    const references = analysis.references.length > 0
      ? analysis.references
      : parseDocumentReferences({ source: input.source, kind: input.kind });
    const anchors = collectAnchors(analysis, input.source, input.kind);
    const diagnostics: LinkDiagnostic[] = [];

    if (analysis.error !== undefined) {
      diagnostics.push({
        message: `文件解析失敗，無法完整檢查引用：${analysis.error}`,
        code: 'parse-error',
        severity: 'error',
        range: createDocumentStartRange(),
        reference: createSyntheticReference(input.kind),
      });
    }

    // 未受信任工作區只做純文字解析，不接觸任何 workspace 檔案，避免把
    // 不可信內容轉成檔案存在性或 anchor 資訊。
    if (input.workspaceTrusted === false) {
      return diagnostics;
    }

    for (const reference of references) {
      throwIfCancelled(signal);
      const target = resolveLinkTarget(
        input.sourcePath,
        reference.target,
        input.workspaceRoots ?? [],
      );
      const diagnostic = await this.checkReference(
        input,
        reference,
        target,
        anchors,
        signal,
      );
      if (diagnostic !== undefined) {
        diagnostics.push(diagnostic);
      }
    }

    return diagnostics;
  }

  private async checkReference(
    input: LinkCheckInput,
    reference: DocumentReference,
    target: ResolvedLinkTarget,
    currentAnchors: ReadonlySet<string>,
    signal: AbortSignal | undefined,
  ): Promise<LinkDiagnostic | undefined> {
    throwIfCancelled(signal);
    if (target.kind === 'external' || target.kind === 'unavailable') {
      return undefined;
    }

    if (target.kind === 'unsafe') {
      return createDiagnostic(
        reference,
        'unsafe-path',
        'error',
        `引用路徑不在目前 workspace 內：${reference.target}`,
      );
    }

    if (target.path === undefined) {
      return undefined;
    }

    if (target.kind === 'internal') {
      if (target.fragment === undefined || target.fragment.length === 0) {
        return undefined;
      }
      return hasAnchor(currentAnchors, target.fragment)
        ? undefined
        : createMissingAnchorDiagnostic(reference, target.fragment);
    }

    const fileType = await this.fileSystem.stat(target.path);
    throwIfCancelled(signal);
    if (fileType === 'unknown') {
      return createDiagnostic(
        reference,
        'missing-file',
        'error',
        `找不到引用檔案：${reference.target}`,
      );
    }
    if (fileType === 'directory') {
      return createDiagnostic(
        reference,
        'missing-file',
        'error',
        `引用目標不是檔案：${reference.target}`,
      );
    }

    if (target.fragment === undefined || target.fragment.length === 0) {
      return undefined;
    }

    if (input.sourcePath !== undefined && pathsEqual(input.sourcePath, target.path)) {
      return hasAnchor(currentAnchors, target.fragment)
        ? undefined
        : createMissingAnchorDiagnostic(reference, target.fragment);
    }

    try {
      const targetSource = await this.fileSystem.readFile(target.path);
      throwIfCancelled(signal);
      const targetKind = resolveTargetKind(target.path);
      if (targetKind === undefined) {
        return undefined;
      }
      const targetAnalysis = analyzeDocument({
        documentUri: target.path,
        kind: targetKind,
        source: targetSource,
        sourcePath: target.path,
      });
      const targetAnchors = collectAnchors(targetAnalysis, targetSource, targetKind);
      return hasAnchor(targetAnchors, target.fragment)
        ? undefined
        : createMissingAnchorDiagnostic(reference, target.fragment);
    } catch (error) {
      if (error instanceof LinkCheckCancelledError) {
        throw error;
      }
      return createDiagnostic(
        reference,
        'read-error',
        'error',
        `無法讀取引用檔案：${reference.target}`,
      );
    }
  }
}

export function resolveTargetKind(filePath: string): DocumentKind | undefined {
  const lowerPath = filePath.toLocaleLowerCase();
  if (lowerPath.endsWith('.md')) {
    return 'markdown';
  }
  if (lowerPath.endsWith('.adoc') || lowerPath.endsWith('.asciidoc')) {
    return 'asciidoc';
  }
  return undefined;
}

function collectAnchors(
  analysis: DocumentAnalysis,
  source: string,
  kind: DocumentKind,
): ReadonlySet<string> {
  return new Set([
    ...analysis.anchors,
    ...parseExplicitAnchors(source, kind),
  ]);
}

function hasAnchor(anchors: ReadonlySet<string>, fragment: string): boolean {
  return anchors.has(fragment)
    || anchors.has(fragment.replace(/^_/u, ''))
    || anchors.has(`_${fragment}`);
}

function createMissingAnchorDiagnostic(
  reference: DocumentReference,
  fragment: string,
): LinkDiagnostic {
  return createDiagnostic(
    reference,
    'missing-anchor',
    'error',
    `找不到文件內 anchor：#${fragment}`,
  );
}

function createDiagnostic(
  reference: DocumentReference,
  code: LinkDiagnosticCode,
  severity: LinkDiagnosticSeverity,
  message: string,
): LinkDiagnostic {
  return {
    message,
    code,
    severity,
    range: reference.range,
    reference,
  };
}

function createDocumentStartRange(): DocumentRange {
  return {
    start: { line: 0, character: 0 },
    end: { line: 0, character: 1 },
  };
}

function createSyntheticReference(kind: DocumentKind): DocumentReference {
  return {
    kind: kind === 'markdown' ? 'link' : 'xref',
    target: '',
    range: createDocumentStartRange(),
  };
}

function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw new LinkCheckCancelledError();
  }
}
