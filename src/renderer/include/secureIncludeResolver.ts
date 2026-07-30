import path from 'node:path';

import {
  isMissingFileError,
  nodeIncludeFileSystem,
  type IncludeFileSystem,
} from './includeFileSystem';
import {
  classifyIncludeTarget,
  createCanonicalIncludeRoots,
  createPathKey,
  isPathWithinRoot,
  type CanonicalIncludeRoot,
  type IncludePathApi,
} from './includePathPolicy';
import type {
  IncludeLoadRequest,
  IncludeResolution,
  LocalIncludeSnapshot,
  OpenDocumentSnapshot,
} from './includeTypes';

export interface SecureIncludeResolverOptions {
  readonly caseSensitive?: boolean;
  readonly fileSystem?: IncludeFileSystem;
  readonly pathApi?: IncludePathApi;
}

/**
 * 只解析受信任工作區提供的本機相對 include。
 *
 * 字面路徑與 `realpath` 後的實體路徑都必須位於允許 root 內，
 * 避免 symbolic link 或 Windows junction 逸出。
 */
export class SecureIncludeResolver {
  private readonly caseSensitive: boolean;
  private readonly fileSystem: IncludeFileSystem;
  private readonly openDocuments: ReadonlyMap<string, OpenDocumentSnapshot>;
  private readonly pathApi: IncludePathApi;
  private readonly roots: readonly CanonicalIncludeRoot[];

  public constructor(
    snapshot: LocalIncludeSnapshot,
    options: SecureIncludeResolverOptions = {},
  ) {
    this.fileSystem = options.fileSystem ?? nodeIncludeFileSystem;
    this.pathApi = options.pathApi ?? path;
    this.caseSensitive = options.caseSensitive
      ?? process.platform !== 'win32';
    this.roots = createCanonicalIncludeRoots(
      snapshot.allowedRootPaths,
      this.fileSystem,
      {
        caseSensitive: this.caseSensitive,
        pathApi: this.pathApi,
      },
    );
    this.openDocuments = this.createOpenDocumentIndex(
      snapshot.openDocuments,
    );
  }

  public resolve(request: IncludeLoadRequest): IncludeResolution {
    const classification = classifyIncludeTarget(
      request.target,
      this.pathApi,
    );
    if (classification.kind === 'rejected') {
      return {
        kind: 'rejected',
        reason: classification.reason,
        target: request.target,
      };
    }

    const includingFilePath = this.pathApi.resolve(
      request.includingFilePath,
    );
    const requestedPath = this.pathApi.resolve(
      this.pathApi.dirname(includingFilePath),
      request.target,
    );
    if (!this.isLexicallyAllowed(includingFilePath, requestedPath)) {
      return {
        kind: 'rejected',
        reason: 'outside-root',
        target: request.target,
      };
    }

    let canonicalPath: string;
    try {
      canonicalPath = this.pathApi.resolve(
        this.fileSystem.realpath(requestedPath),
      );
    } catch (error) {
      return isMissingFileError(error)
        ? this.createMissingResult(
            requestedPath,
            request.optional === true,
          )
        : {
            kind: 'rejected',
            reason: 'unreadable',
            target: request.target,
          };
    }

    if (!this.isCanonicallyAllowed(canonicalPath)) {
      return {
        kind: 'rejected',
        reason: 'outside-root',
        target: request.target,
      };
    }

    try {
      if (!this.fileSystem.stat(canonicalPath).isFile) {
        return {
          kind: 'rejected',
          reason: 'not-file',
          target: request.target,
        };
      }
    } catch (error) {
      return isMissingFileError(error)
        ? this.createMissingResult(
            requestedPath,
            request.optional === true,
          )
        : {
            kind: 'rejected',
            reason: 'unreadable',
            target: request.target,
          };
    }

    const dependency = {
      canonicalPath,
      requestedPath,
      state: 'loaded' as const,
    };
    const openDocument = this.openDocuments.get(
      this.createPathKey(canonicalPath),
    );
    if (openDocument !== undefined) {
      return {
        content: openDocument.text,
        dependency,
        kind: 'loaded',
        snapshotVersion: openDocument.version,
        source: 'open-document',
      };
    }

    try {
      return {
        content: this.fileSystem.readUtf8File(canonicalPath),
        dependency,
        kind: 'loaded',
        source: 'file-system',
      };
    } catch (error) {
      return isMissingFileError(error)
        ? this.createMissingResult(
            requestedPath,
            request.optional === true,
          )
        : {
            kind: 'rejected',
            reason: 'unreadable',
            target: request.target,
          };
    }
  }

  private createOpenDocumentIndex(
    openDocuments: readonly OpenDocumentSnapshot[],
  ): ReadonlyMap<string, OpenDocumentSnapshot> {
    const snapshots = new Map<string, OpenDocumentSnapshot>();

    for (const openDocument of openDocuments) {
      const requestedPath = this.pathApi.resolve(openDocument.path);
      if (!this.roots.some((root) => this.isWithin(
        requestedPath,
        root.requestedPath,
      ))) {
        continue;
      }

      try {
        const canonicalPath = this.pathApi.resolve(
          this.fileSystem.realpath(requestedPath),
        );
        if (
          !this.isCanonicallyAllowed(canonicalPath)
          || !this.fileSystem.stat(canonicalPath).isFile
        ) {
          continue;
        }

        const key = this.createPathKey(canonicalPath);
        const current = snapshots.get(key);
        if (
          current === undefined
          || openDocument.version > current.version
        ) {
          snapshots.set(key, openDocument);
        }
      } catch {
        // 已刪除或不可解析的開啟文件不能繞過 canonical root 驗證。
      }
    }

    return snapshots;
  }

  private isLexicallyAllowed(
    includingFilePath: string,
    requestedPath: string,
  ): boolean {
    return this.roots.some((root) => (
      this.isWithin(includingFilePath, root.requestedPath)
      && this.isWithin(requestedPath, root.requestedPath)
    ));
  }

  private isCanonicallyAllowed(canonicalPath: string): boolean {
    return this.roots.some(
      (root) => this.isWithin(canonicalPath, root.canonicalPath),
    );
  }

  private isWithin(candidatePath: string, rootPath: string): boolean {
    return isPathWithinRoot(candidatePath, rootPath, {
      caseSensitive: this.caseSensitive,
      pathApi: this.pathApi,
    });
  }

  private createPathKey(filePath: string): string {
    return createPathKey(
      filePath,
      this.pathApi,
      this.caseSensitive,
    );
  }

  private createMissingResult(
    requestedPath: string,
    optional: boolean,
  ): IncludeResolution {
    return {
      dependency: {
        requestedPath,
        state: 'missing',
      },
      kind: 'missing',
      optional,
    };
  }
}

