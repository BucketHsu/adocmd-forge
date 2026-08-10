import { describe, expect, it } from 'vitest';

import { ImageService } from '../../../src/images/imageService';
import type {
  ImageFileSystem,
  ImageServiceSettings,
} from '../../../src/images/imageTypes';

class FakeFileSystem implements ImageFileSystem {
  public readonly files = new Map<string, Uint8Array>();
  public readonly directories: string[] = [];

  public exists(filePath: string): Promise<boolean> {
    return Promise.resolve(this.files.has(filePath));
  }

  public createDirectory(directoryPath: string): Promise<void> {
    this.directories.push(directoryPath);
    return Promise.resolve();
  }

  public writeFile(filePath: string, data: Uint8Array): Promise<void> {
    this.files.set(filePath, data);
    return Promise.resolve();
  }

  public deleteFile(filePath: string): Promise<void> {
    this.files.delete(filePath);
    return Promise.resolve();
  }

  public readFile(filePath: string): Promise<Uint8Array> {
    const data = this.files.get(filePath);
    if (data === undefined) {
      throw new Error('missing');
    }
    return Promise.resolve(data);
  }
}

function createService(
  fileSystem: FakeFileSystem,
  settings: Partial<ImageServiceSettings> = {},
  selectedPath?: string,
): ImageService {
  return new ImageService(
    fileSystem,
    {
      pick: (): Promise<string | undefined> => Promise.resolve(selectedPath),
    },
    {
      directory: settings.directory ?? 'images',
      promptForPath: settings.promptForPath ?? false,
      defaultAltText: settings.defaultAltText ?? 'filename',
    },
  );
}

const context = {
  documentPath: '/workspace/docs/guide.adoc',
  workspaceRootPath: '/workspace',
  language: 'asciidoc' as const,
  isTrusted: true,
};

describe('ImageService', (): void => {
  it('prepares, saves and removes a unique AsciiDoc image operation', async (): Promise<void> => {
    const fileSystem = new FakeFileSystem();
    fileSystem.files.set('/workspace/docs/images/diagram.png', new Uint8Array([0]));
    const service = createService(fileSystem);
    const operation = await service.prepare(context, {
      name: 'diagram.png',
      data: new Uint8Array([1, 2]),
    });

    expect(operation).toMatchObject({
      targetPath: '/workspace/docs/images/diagram-2.png',
      relativePath: 'images/diagram-2.png',
      altText: 'diagram-2',
      syntax: 'image::images/diagram-2.png[diagram-2]',
    });
    if (operation === undefined) {
      throw new Error('Expected image operation.');
    }

    await service.save(operation);
    expect(fileSystem.files.get(operation.targetPath)).toEqual(new Uint8Array([1, 2]));
    await service.remove(operation);
    expect(fileSystem.files.has(operation.targetPath)).toBe(false);
  });

  it('uses custom alt text and supports Markdown', async (): Promise<void> => {
    const fileSystem = new FakeFileSystem();
    const service = new ImageService(
      fileSystem,
      { pick: (): Promise<string | undefined> => Promise.resolve(undefined) },
      { directory: 'assets', promptForPath: false, defaultAltText: '文件圖片' },
    );
    const operation = await service.prepare(
      { ...context, language: 'markdown' },
      { name: 'capture', mimeType: 'image/png', data: new Uint8Array([1]) },
    );

    expect(operation?.syntax).toBe('![文件圖片](assets/capture.png)');
  });

  it('returns undefined when the target prompt is cancelled', async (): Promise<void> => {
    const service = createService(new FakeFileSystem(), { promptForPath: true });
    await expect(service.prepare(context, {
      name: 'diagram.png',
      data: new Uint8Array([1]),
    })).resolves.toBeUndefined();
  });

  it.each([
    { ...context, isTrusted: false },
    { ...context, documentPath: undefined },
    { ...context, workspaceRootPath: undefined },
    { ...context, documentPath: '/outside/guide.adoc' },
  ])('rejects an unsafe document context', async (unsafeContext): Promise<void> => {
    const service = createService(new FakeFileSystem());
    await expect(service.prepare(unsafeContext, {
      name: 'diagram.png',
      data: new Uint8Array([1]),
    })).rejects.toThrow();
  });

  it('rejects duplicate writes and cleans up safely', async (): Promise<void> => {
    const fileSystem = new FakeFileSystem();
    const service = createService(fileSystem);
    const operation = await service.prepare(context, {
      name: 'diagram.png',
      data: new Uint8Array([1]),
    });
    if (operation === undefined) {
      throw new Error('Expected image operation.');
    }
    fileSystem.files.set(operation.targetPath, new Uint8Array([2]));
    await expect(service.save(operation)).rejects.toThrow();
    await service.remove(operation);
    expect(fileSystem.files.has(operation.targetPath)).toBe(false);
  });

  it('validates a prompted target and reads selected source bytes', async (): Promise<void> => {
    const fileSystem = new FakeFileSystem();
    fileSystem.files.set('/tmp/source.jpg', new Uint8Array([8]));
    const service = createService(
      fileSystem,
      { promptForPath: true },
      '/workspace/docs/images/custom.jpg',
    );
    const operation = await service.prepare(context, {
      name: 'source.jpg',
      data: new Uint8Array([8]),
    });
    expect(operation?.relativePath).toBe('images/custom.jpg');
    await expect(service.readSource(context, '/tmp/source.jpg')).resolves.toEqual({
      name: 'source.jpg',
      data: new Uint8Array([8]),
    });
    await expect(service.prepare(context, {
      name: 'source.exe',
      data: new Uint8Array([8]),
    })).rejects.toThrow();
  });
});
