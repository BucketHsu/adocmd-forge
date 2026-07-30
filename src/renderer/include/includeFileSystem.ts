import {
  readFileSync,
  realpathSync,
  statSync,
} from 'node:fs';

export interface IncludeFileStat {
  readonly isDirectory: boolean;
  readonly isFile: boolean;
}

/**
 * Asciidoctor 的 IncludeProcessor 是同步 API，因此此邊界也必須保持同步。
 */
export interface IncludeFileSystem {
  readUtf8File(filePath: string): string;
  realpath(filePath: string): string;
  stat(filePath: string): IncludeFileStat;
}

export const nodeIncludeFileSystem: IncludeFileSystem = {
  readUtf8File(filePath: string): string {
    return readFileSync(filePath, 'utf8');
  },
  realpath(filePath: string): string {
    return realpathSync.native(filePath);
  },
  stat(filePath: string): IncludeFileStat {
    const stat = statSync(filePath);
    return {
      isDirectory: stat.isDirectory(),
      isFile: stat.isFile(),
    };
  },
};

export function isMissingFileError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false;
  }

  return error.code === 'ENOENT' || error.code === 'ENOTDIR';
}

