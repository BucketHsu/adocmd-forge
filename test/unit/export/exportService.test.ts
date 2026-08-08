import { describe, expect, it } from 'vitest';

import { ExportService } from '../../../src/export/exportService';
import type {
  ExportFileSystem,
  ExportInput,
  ExportRenderer,
} from '../../../src/export/exportTypes';

class FakeExportFileSystem implements ExportFileSystem {
  public readonly files = new Map<string, Uint8Array>();
  public readonly directories: string[] = [];
  public failRead = false;
  public failWrite = false;

  public readFile(filePath: string): Promise<Uint8Array> {
    if (this.failRead) {
      return Promise.reject(new Error('read failed'));
    }
    const data = this.files.get(filePath);
    if (data === undefined) {
      return Promise.reject(new Error(`missing ${filePath}`));
    }
    return Promise.resolve(data);
  }

  public writeFile(filePath: string, data: Uint8Array): Promise<void> {
    if (this.failWrite) {
      return Promise.reject(new Error('write failed'));
    }
    this.files.set(filePath, data);
    return Promise.resolve();
  }

  public createDirectory(directoryPath: string): Promise<void> {
    this.directories.push(directoryPath);
    return Promise.resolve();
  }

  public stat(filePath: string): Promise<{ type: 'file' | 'directory' | 'unknown' }> {
    return Promise.resolve({ type: this.files.has(filePath) ? 'file' : 'unknown' });
  }
}

function createRenderer(html = '<h1 data-source-line="0">主標題</h1><p><img src="images/圖.png"><a href="other.md#章節">連結</a></p>'): ExportRenderer {
  return (request): Promise<{ html: string; lineCount: number; title: string }> => Promise.resolve({
    html,
    lineCount: request.source.split('\n').length,
    title: request.kind === 'markdown' ? 'Markdown 標題' : 'AsciiDoc 標題',
  });
}

function createInput(format: ExportInput['format'], destinationPath?: string): ExportInput {
  return {
    kind: 'markdown',
    source: '# 標題\n\n內容',
    sourcePath: '/workspace/docs/guide.md',
    workspaceRootPath: '/workspace',
    workspaceTrusted: true,
    format,
    ...(destinationPath === undefined ? {} : { destinationPath }),
  };
}

describe('ExportService', (): void => {
  it('exports Markdown as a complete HTML document with portable resources', async (): Promise<void> => {
    const fileSystem = new FakeExportFileSystem();
    const service = new ExportService(fileSystem, createRenderer());

    const result = await service.export(createInput('html', '/workspace/out/guide.html'));
    const content = new TextDecoder().decode(fileSystem.files.get('/workspace/out/guide.html'));

    expect(result.destinationPath).toBe('/workspace/out/guide.html');
    expect(content).toContain('<!doctype html>');
    expect(content).toContain('../docs/images/%E5%9C%96.png');
    expect(content).toContain('../docs/other.md#章節');
    expect(fileSystem.directories).toEqual(['/workspace/out']);
  });

  it('exports AsciiDoc Embedded HTML as sanitized fragment', async (): Promise<void> => {
    const service = new ExportService(
      new FakeExportFileSystem(),
      createRenderer('<h1>標題</h1><script>alert(1)</script><p>內容</p>'),
    );
    const result = await service.export({
      ...createInput('embedded-html'),
      kind: 'asciidoc',
      source: '= 標題\n\n內容',
    });

    expect(result.content).toBe('<h1>標題</h1><p>內容</p>');
    expect(result.content).not.toContain('<script');
    expect(result.content).not.toContain('<html');
  });

  it('inlines local images for Standalone HTML and removes unavailable images', async (): Promise<void> => {
    const fileSystem = new FakeExportFileSystem();
    fileSystem.files.set('/workspace/docs/images/圖.png', new Uint8Array([0, 1, 2]));
    const service = new ExportService(fileSystem, createRenderer());

    const result = await service.export(createInput('standalone-html', '/workspace/out/guide.html'));

    expect(result.content).toContain('<!doctype html>');
    expect(result.content).toContain('src="data:image/png;base64,AAEC"');
    fileSystem.failRead = true;
    const missing = await service.export(createInput('standalone-html', '/workspace/out/missing.html'));
    expect(missing.content).toContain('<img');
    expect(missing.content).not.toContain('src="images/');
  });

  it('renders empty documents and propagates renderer/write failures', async (): Promise<void> => {
    const fileSystem = new FakeExportFileSystem();
    const service = new ExportService(fileSystem, (): Promise<never> => Promise.reject(new Error('renderer failed')));
    await expect(service.export(createInput('html'))).rejects.toThrow('renderer failed');

    const writeFileSystem = new FakeExportFileSystem();
    writeFileSystem.failWrite = true;
    const writeService = new ExportService(writeFileSystem, createRenderer('<p></p>'));
    await expect(writeService.export(createInput('html', '/workspace/out/result.html'))).rejects.toThrow('write failed');
    const empty = await new ExportService(new FakeExportFileSystem(), createRenderer('<p></p>')).export({
      ...createInput('embedded-html'),
      source: '',
    });
    expect(empty.content).toBe('<p></p>');
  });

  it('rejects untrusted workspaces, unsafe paths, source overwrite and existing files', async (): Promise<void> => {
    const fileSystem = new FakeExportFileSystem();
    const service = new ExportService(fileSystem, createRenderer());
    await expect(service.export({
      ...createInput('html', '/workspace/out.html'),
      workspaceTrusted: false,
    })).rejects.toThrow('受信任');
    await expect(service.export(createInput('html', '/outside/out.html'))).rejects.toThrow('目前工作區');
    await expect(service.export(createInput('html', '/workspace/docs/guide.md'))).rejects.toThrow('不可覆蓋');
    fileSystem.files.set('/workspace/out.html', new Uint8Array([1]));
    await expect(service.export(createInput('html', '/workspace/out.html'))).rejects.toThrow('已存在');
    await expect(service.export({
      ...createInput('html'),
      workspaceTrusted: false,
    })).resolves.toBeDefined();
  });
});
