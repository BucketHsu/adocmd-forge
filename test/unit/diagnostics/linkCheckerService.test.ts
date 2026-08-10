import { describe, expect, it } from 'vitest';

import {
  LinkCheckCancelledError,
  LinkCheckerService,
  type LinkCheckFileSystem,
  type LinkFileType,
} from '../../../src/diagnostics/linkCheckerService';

class MemoryFileSystem implements LinkCheckFileSystem {
  public readonly reads: string[] = [];
  public readonly stats: string[] = [];
  public readonly files = new Map<string, string>();
  public readonly directories = new Set<string>();
  public readonly readErrors = new Set<string>();
  public readonly readCancellations = new Set<string>();

  public stat(filePath: string): Promise<LinkFileType> {
    this.stats.push(filePath);
    if (this.files.has(filePath)) {
      return Promise.resolve('file');
    }
    if (this.directories.has(filePath)) {
      return Promise.resolve('directory');
    }
    return Promise.resolve('unknown');
  }

  public readFile(filePath: string): Promise<string> {
    this.reads.push(filePath);
    if (this.readErrors.has(filePath)) {
      return Promise.reject(new Error('read failed'));
    }
    if (this.readCancellations.has(filePath)) {
      return Promise.reject(new LinkCheckCancelledError());
    }
    const value = this.files.get(filePath);
    if (value === undefined) {
      return Promise.reject(new Error('not found'));
    }
    return Promise.resolve(value);
  }
}

const workspaceInput = {
  documentUri: 'file:///workspace/docs/main.md',
  sourcePath: '/workspace/docs/main.md',
  workspaceRoots: ['/workspace'],
  workspaceTrusted: true,
};

describe('LinkCheckerService', (): void => {
  it('檢查 Markdown link/image、檔案、anchor 與 workspace 路徑', async (): Promise<void> => {
    const fileSystem = new MemoryFileSystem();
    fileSystem.files.set('/workspace/docs/other.md', '# Target\n\n{#explicit}\n');
    fileSystem.files.set('/workspace/docs/images/logo.png', 'binary');
    const service = new LinkCheckerService(fileSystem);
    const diagnostics = await service.check({
      ...workspaceInput,
      kind: 'markdown',
      source: [
        '# Intro',
        '',
        '{#explicit}',
        '',
        '[valid](other.md#target)',
        '[explicit](#explicit)',
        '[missing file](missing.md)',
        '[missing anchor](other.md#absent)',
        '[outside](../../secret.md)',
        '[local missing](#absent)',
        '![logo](images/logo.png)',
        '[external](https://example.com/docs#remote)',
        '```markdown',
        '[ignored](ignored.md)',
        '```',
      ].join('\n'),
    });

    expect(diagnostics.map(({ code, message }) => ({ code, message }))).toEqual([
      {
        code: 'missing-file',
        message: '找不到引用檔案：missing.md',
      },
      {
        code: 'missing-anchor',
        message: '找不到文件內 anchor：#absent',
      },
      {
        code: 'unsafe-path',
        message: '引用路徑不在目前 workspace 內：../../secret.md',
      },
      {
        code: 'missing-anchor',
        message: '找不到文件內 anchor：#absent',
      },
    ]);
    expect(diagnostics[0]?.range).toEqual({
      start: { line: 6, character: 15 },
      end: { line: 6, character: 25 },
    });
    expect(fileSystem.stats).not.toContain('/workspace/docs/ignored.md');
  });

  it('檢查 AsciiDoc link、xref、include、image 與 shorthand anchor', async (): Promise<void> => {
    const fileSystem = new MemoryFileSystem();
    fileSystem.files.set('/workspace/docs/guide.adoc', '= Guide\n\n== Intro\n');
    fileSystem.files.set('/workspace/docs/parts.adoc', '= Part\n');
    fileSystem.files.set('/workspace/docs/images/logo.png', 'binary');
    fileSystem.files.set('/workspace/docs/images/inline-logo.png', 'binary');
    const service = new LinkCheckerService(fileSystem);
    const diagnostics = await service.check({
      ...workspaceInput,
      documentUri: 'file:///workspace/docs/main.adoc',
      sourcePath: '/workspace/docs/main.adoc',
      kind: 'asciidoc',
      source: [
        '= Main',
        '',
        'link:guide.adoc#missing-link[Broken link]',
        'xref:guide.adoc#_intro[Guide]',
        'xref:guide.adoc#missing[Broken]',
        'include::parts.adoc[]',
        'image::images/logo.png[Logo]',
        'image:images/inline-logo.png[Inline logo]',
        '<<#no-main,Main>>',
      ].join('\n'),
    });

    expect(diagnostics.map(({ code, message }) => ({ code, message }))).toEqual([
      {
        code: 'missing-anchor',
        message: '找不到文件內 anchor：#missing-link',
      },
      {
        code: 'missing-anchor',
        message: '找不到文件內 anchor：#missing',
      },
      {
        code: 'missing-anchor',
        message: '找不到文件內 anchor：#no-main',
      },
    ]);
  });

  it('依 AsciiDoc imagesdir 檢查區塊與行內圖片', async (): Promise<void> => {
    const fileSystem = new MemoryFileSystem();
    fileSystem.files.set('/workspace/docs/assets/logo.png', 'binary');
    fileSystem.files.set('/workspace/docs/assets/icon.svg', 'binary');
    const service = new LinkCheckerService(fileSystem);

    await expect(service.check({
      ...workspaceInput,
      documentUri: 'file:///workspace/docs/main.adoc',
      sourcePath: '/workspace/docs/main.adoc',
      kind: 'asciidoc',
      source: [
        '= Main',
        ':imagesdir: assets',
        '',
        'image::logo.png[Logo]',
        'image:icon.svg[Icon]',
      ].join('\n'),
    })).resolves.toEqual([]);
    expect(fileSystem.stats).toEqual([
      '/workspace/docs/assets/logo.png',
      '/workspace/docs/assets/icon.svg',
    ]);
  });

  it('在未受信任、untitled 或 workspace 外時不讀取本機檔案', async (): Promise<void> => {
    const fileSystem = new MemoryFileSystem();
    fileSystem.files.set('/workspace/docs/other.md', '# Target');
    const service = new LinkCheckerService(fileSystem);
    const source = '[local](other.md)\n[external](https://example.com)';

    const untrusted = await service.check({
      ...workspaceInput,
      kind: 'markdown',
      source,
      workspaceTrusted: false,
    });
    const untitled = await service.check({
      documentUri: 'untitled:main',
      kind: 'markdown',
      source,
      workspaceTrusted: true,
    });
    expect(untrusted).toEqual([]);
    expect(untitled).toEqual([]);
    expect(fileSystem.stats).toEqual([]);
  });

  it('辨識目錄、檔案讀取失敗與 URI query/fragment', async (): Promise<void> => {
    const fileSystem = new MemoryFileSystem();
    fileSystem.directories.add('/workspace/docs/folder');
    fileSystem.files.set('/workspace/docs/broken.md', '# Broken');
    fileSystem.readErrors.add('/workspace/docs/broken.md');
    const service = new LinkCheckerService(fileSystem);
    const diagnostics = await service.check({
      ...workspaceInput,
      kind: 'markdown',
      source: [
        '[directory](folder/)',
        '[read error](broken.md?cache=1#anchor)',
      ].join('\n'),
    });

    expect(diagnostics.map(({ code }) => code)).toEqual([
      'missing-file',
      'read-error',
    ]);
    expect(diagnostics[0]?.message).toBe('引用目標不是檔案：folder/');
  });

  it('收到取消訊號時停止檢查，不產生部分成功結果', async (): Promise<void> => {
    const fileSystem = new MemoryFileSystem();
    const controller = new AbortController();
    controller.abort();
    const service = new LinkCheckerService(fileSystem);

    await expect(service.check({
      ...workspaceInput,
      kind: 'markdown',
      source: '[missing](missing.md)',
    }, controller.signal)).rejects.toBeInstanceOf(LinkCheckCancelledError);
    expect(fileSystem.stats).toEqual([]);
  });

  it('同一檔案的缺少 anchor 與未知副檔名不誤報為檔案錯誤', async (): Promise<void> => {
    const fileSystem = new MemoryFileSystem();
    fileSystem.files.set('/workspace/docs/main.md', '# Main\n');
    fileSystem.files.set('/workspace/docs/data.txt', 'plain text');
    const service = new LinkCheckerService(fileSystem);
    const diagnostics = await service.check({
      ...workspaceInput,
      kind: 'markdown',
      source: [
        '[self](main.md#missing)',
        '[data](data.txt#ignored)',
      ].join('\n'),
    });

    expect(diagnostics.map(({ code, message }) => ({ code, message }))).toEqual([
      {
        code: 'missing-anchor',
        message: '找不到文件內 anchor：#missing',
      },
    ]);
  });

  it('讀取目標時若檔案系統回報取消，會原樣傳遞取消例外', async (): Promise<void> => {
    const fileSystem = new MemoryFileSystem();
    fileSystem.files.set('/workspace/docs/other.md', '# Other');
    fileSystem.readCancellations.add('/workspace/docs/other.md');
    const service = new LinkCheckerService(fileSystem);

    await expect(service.check({
      ...workspaceInput,
      kind: 'markdown',
      source: '[other](other.md#other)',
    })).rejects.toBeInstanceOf(LinkCheckCancelledError);
  });
});
