import { realpathSync } from 'node:fs';
import path from 'node:path';

import type {
  Asciidoctor,
  Document,
  Extensions,
  LoggerMessage,
  Reader,
} from '@asciidoctor/core';

import {
  createPathKey,
} from './includePathPolicy';
import {
  createIncludeTraversalContext,
  enterInclude,
  type IncludeTraversalContext,
} from './includeTraversalPolicy';
import {
  SecureIncludeResolver,
  type SecureIncludeResolverOptions,
} from './secureIncludeResolver';
import { selectIncludeContent } from './includeSelector';
import type { IncludeResolution } from './includeTypes';

export interface SecureIncludeProcessorOptions {
  readonly allowedRootPaths: readonly string[];
  readonly sourcePath: string;
}

/**
 * 建立只供單次 render 使用的 Asciidoctor IncludeProcessor registry。
 *
 * Asciidoctor 的預設 safe mode 只以來源文件目錄作為邊界，無法表達 VS Code
 * workspace 的允許根目錄，也不會檢查 symbolic link 是否逸出。這裡將所有
 * `include::` 交給 SecureIncludeResolver，並在 renderer worker 內維持巢狀
 * include 的循環與深度狀態；registry 不註冊到全域，避免不同文件之間共享狀態。
 */
export function createSecureIncludeRegistry(
  asciidoctor: Asciidoctor,
  options: SecureIncludeProcessorOptions,
): Extensions.Registry | undefined {
  const sourcePath = path.resolve(options.sourcePath);
  const resolverOptions: SecureIncludeResolverOptions = {
    caseSensitive: process.platform !== 'win32',
  };
  let resolver: SecureIncludeResolver;
  try {
    resolver = new SecureIncludeResolver({
      allowedRootPaths: options.allowedRootPaths,
      openDocuments: [],
    }, resolverOptions);
  } catch {
    // 來源檔案尚未實際存在或 workspace root 已被移除時，停用本次 include，
    // 讓一般文件內容仍可預覽，而不是讓整個 render 失敗。
    return undefined;
  }

  const sourceCanonicalPath = canonicalizePath(sourcePath);
  const traversalContexts = new Map<string, IncludeTraversalContext>([
    [
      createPathKey(sourceCanonicalPath),
      createIncludeTraversalContext(sourceCanonicalPath),
    ],
  ]);
  const registry = asciidoctor.Extensions.create('adocmd-forge-secure-include');

  registry.includeProcessor(function (this: Extensions.IncludeProcessorDsl): void {
    this.handles(() => true);
    this.prefer();
    this.process(function (
      document: Document,
      reader: Reader,
      target: string,
      attributes: Readonly<Record<string, unknown>>,
    ): void {
      const includingFilePath = getIncludingFilePath(reader, sourcePath);
      const resolution = resolver.resolve({
        includingFilePath,
        optional: isOptionalInclude(attributes),
        target,
      });

      if (resolution.kind !== 'loaded') {
        reportIncludeFailure(document, reader, target, resolution);
        return;
      }

      const includingCanonicalPath = canonicalizePath(includingFilePath);
      const currentContext = traversalContexts.get(
        createPathKey(includingCanonicalPath),
      ) ?? createIncludeTraversalContext(sourceCanonicalPath);
      const traversal = enterInclude(
        currentContext,
        resolution.dependency.canonicalPath,
      );
      if (traversal.kind === 'rejected') {
        reportTraversalFailure(document, reader, target, traversal.reason);
        return;
      }

      const selection = selectIncludeContent(resolution.content, attributes);
      reportSelectionIssues(document, reader, target, selection.issues);
      traversalContexts.set(
        createPathKey(resolution.dependency.canonicalPath),
        traversal.context,
      );
      reader.pushInclude(
        selection.data,
        resolution.dependency.canonicalPath,
        resolution.dependency.canonicalPath,
        selection.firstLine,
        attributes,
      );
    });
  });

  return registry;
}

function getIncludingFilePath(
  reader: Reader,
  sourcePath: string,
): string {
  try {
    const cursorPath = reader.getCursor().getPath();
    if (
      cursorPath !== undefined
      && cursorPath.length > 0
      && !cursorPath.startsWith('<')
    ) {
      return path.resolve(cursorPath);
    }
  } catch {
    // A malformed cursor should fall back to the known root source path.
  }
  return sourcePath;
}

function canonicalizePath(filePath: string): string {
  try {
    // realpathSync.native preserves the host platform's case and separator
    // rules, which is important for the Windows case-insensitive comparison.
    return path.resolve(realpathSync.native(filePath));
  } catch {
    return path.resolve(filePath);
  }
}

function isOptionalInclude(
  attributes: Readonly<Record<string, unknown>>,
): boolean {
  if (Object.hasOwn(attributes, 'optional-option')) {
    return true;
  }
  const positional = attributes.$positional;
  return Array.isArray(positional)
    && positional.some((value) => value === 'optional');
}

function reportIncludeFailure(
  document: Document,
  reader: Reader,
  target: string,
  resolution: Exclude<IncludeResolution, { kind: 'loaded' }>,
): void {
  if (resolution.kind === 'missing' && resolution.optional) {
    return;
  }

  const message = resolution.kind === 'missing'
    ? `include 找不到檔案：${target}`
    : `include 無法載入「${target}」：${resolution.reason}`;
  logWithReader(document, reader, 'ERROR', message);
}

function reportTraversalFailure(
  document: Document,
  reader: Reader,
  target: string,
  reason: 'cycle' | 'max-depth',
): void {
  const message = reason === 'cycle'
    ? `include 偵測到循環引用：${target}`
    : `include 超過最大巢狀深度：${target}`;
  logWithReader(document, reader, 'ERROR', message);
}

function reportSelectionIssues(
  document: Document,
  reader: Reader,
  target: string,
  issues: readonly {
    readonly code: string;
    readonly expectedTag?: string;
    readonly line?: number;
    readonly tag: string;
  }[],
): void {
  for (const issue of issues) {
    const location = issue.line === undefined ? '' : `（第 ${String(issue.line)} 行）`;
    const expected = issue.expectedTag === undefined
      ? ''
      : `，預期 ${issue.expectedTag}`;
    logWithReader(
      document,
      reader,
      'WARN',
      `include ${target} 的 tag ${issue.tag} ${issue.code}${expected}${location}`,
    );
  }
}

function logWithReader(
  document: Document,
  reader: Reader,
  severity: 'ERROR' | 'WARN',
  message: string,
): void {
  const sourceLocation = createIncludeSourceLocation(reader);
  const logMessage: LoggerMessage = reader.createLogMessage(message, {
    source_location: sourceLocation,
  });
  document.getLogger().add(severity, logMessage);
}

function createIncludeSourceLocation(reader: Reader): {
  getDirectory: () => string;
  getFile: () => string | undefined;
  getLineNumber: () => number;
  getPath: () => string;
} {
  const cursor = reader.getCursor();
  const cursorLine = cursor.getLineNumber() ?? 1;
  return {
    getDirectory: (): string => cursor.getDirectory() ?? '',
    getFile: (): string | undefined => cursor.getFile(),
    getLineNumber: (): number => Math.max(1, cursorLine - 1),
    getPath: (): string => cursor.getPath() ?? '<stdin>',
  };
}
