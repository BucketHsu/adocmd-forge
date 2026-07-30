import type {
  IncludeFileStat,
  IncludeFileSystem,
} from '../../../../src/renderer/include';
import {
  createPathKey,
  type IncludePathApi,
} from '../../../../src/renderer/include';

interface FakeEntry {
  readonly content?: string;
  readonly kind: 'directory' | 'file' | 'other';
}

class FakeFileSystemError extends Error {
  public readonly code: string;

  public constructor(code: string, filePath: string) {
    super(`${code}: ${filePath}`);
    this.code = code;
  }
}

export class FakeIncludeFileSystem implements IncludeFileSystem {
  private readonly entries = new Map<string, FakeEntry>();
  private readonly rejectedPaths = new Map<string, string>();
  private readonly resolutions = new Map<string, string>();

  public readCount = 0;

  public constructor(
    private readonly pathApi: IncludePathApi,
    private readonly caseSensitive: boolean,
  ) {
  }

  public addDirectory(
    requestedPath: string,
    canonicalPath: string = requestedPath,
  ): void {
    this.addEntry(
      requestedPath,
      canonicalPath,
      {
        kind: 'directory',
      },
    );
  }

  public addFile(
    requestedPath: string,
    content: string,
    canonicalPath: string = requestedPath,
  ): void {
    this.addEntry(
      requestedPath,
      canonicalPath,
      {
        content,
        kind: 'file',
      },
    );
  }

  public addOther(
    requestedPath: string,
    canonicalPath: string = requestedPath,
  ): void {
    this.addEntry(
      requestedPath,
      canonicalPath,
      {
        kind: 'other',
      },
    );
  }

  public addAlias(aliasPath: string, canonicalPath: string): void {
    this.resolutions.set(
      this.key(aliasPath),
      this.pathApi.resolve(canonicalPath),
    );
  }

  public rejectRealpath(filePath: string, code: string): void {
    this.rejectedPaths.set(this.key(filePath), code);
  }

  public readUtf8File(filePath: string): string {
    this.readCount += 1;
    const entry = this.entries.get(this.key(filePath));
    if (entry?.kind !== 'file') {
      throw new FakeFileSystemError('ENOENT', filePath);
    }
    return entry.content ?? '';
  }

  public realpath(filePath: string): string {
    const key = this.key(filePath);
    const rejectedCode = this.rejectedPaths.get(key);
    if (rejectedCode !== undefined) {
      throw new FakeFileSystemError(rejectedCode, filePath);
    }

    const resolvedPath = this.resolutions.get(key);
    if (resolvedPath === undefined) {
      throw new FakeFileSystemError('ENOENT', filePath);
    }
    return resolvedPath;
  }

  public stat(filePath: string): IncludeFileStat {
    const entry = this.entries.get(this.key(filePath));
    if (entry === undefined) {
      throw new FakeFileSystemError('ENOENT', filePath);
    }
    return {
      isDirectory: entry.kind === 'directory',
      isFile: entry.kind === 'file',
    };
  }

  private addEntry(
    requestedPath: string,
    canonicalPath: string,
    entry: FakeEntry,
  ): void {
    const resolvedCanonicalPath = this.pathApi.resolve(canonicalPath);
    this.resolutions.set(
      this.key(requestedPath),
      resolvedCanonicalPath,
    );
    this.resolutions.set(
      this.key(resolvedCanonicalPath),
      resolvedCanonicalPath,
    );
    this.entries.set(this.key(resolvedCanonicalPath), entry);
  }

  private key(filePath: string): string {
    return createPathKey(
      filePath,
      this.pathApi,
      this.caseSensitive,
    );
  }
}

