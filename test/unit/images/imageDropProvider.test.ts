import { describe, expect, it } from 'vitest';

import { ImageDropProvider } from '../../../src/images/imageDropProvider';
import type {
  ImageTransferFile,
  ImageTransferItem,
} from '../../../src/images/imageDataTransfer';
import { ImageService } from '../../../src/images/imageService';
import type { ImageFileSystem } from '../../../src/images/imageTypes';

class FakeFileSystem implements ImageFileSystem {
  public exists(filePath: string): Promise<boolean> {
    void filePath;
    return Promise.resolve(false);
  }
  public createDirectory(directoryPath: string): Promise<void> {
    void directoryPath;
    return Promise.resolve();
  }
  public writeFile(filePath: string, data: Uint8Array): Promise<void> {
    void filePath;
    void data;
    return Promise.resolve();
  }
  public deleteFile(filePath: string): Promise<void> {
    void filePath;
    return Promise.resolve();
  }
  public readFile(filePath: string): Promise<Uint8Array> {
    void filePath;
    return Promise.resolve(new Uint8Array());
  }
}

describe('ImageDropProvider', (): void => {
  it('prepares a DataTransfer image operation', async (): Promise<void> => {
    const service = new ImageService(
      new FakeFileSystem(),
      { pick: (): Promise<string | undefined> => Promise.resolve(undefined) },
      { directory: 'images', promptForPath: false, defaultAltText: 'filename' },
    );
    const provider = new ImageDropProvider(
      service,
      (): Promise<undefined> => Promise.resolve(undefined),
    );
    const operation = await provider.prepare({
      documentPath: '/workspace/docs/guide.md',
      workspaceRootPath: '/workspace',
      language: 'markdown',
      isTrusted: true,
    }, {
      get: (): undefined => undefined,
      entries: (): readonly (readonly [string, ImageTransferItem])[] => [[
        'image/png',
        {
          asFile: (): ImageTransferFile => ({
            name: 'drop.png',
            data: (): Promise<Uint8Array> => Promise.resolve(new Uint8Array([1])),
          }),
        },
      ]],
    }, { isCancellationRequested: false });

    expect(operation?.syntax).toBe('![drop](images/drop.png)');
  });

  it('does not read or modify a cancelled drop', async (): Promise<void> => {
    let readCalled = false;
    const provider = new ImageDropProvider(
      new ImageService(
        new FakeFileSystem(),
        { pick: (): Promise<string | undefined> => Promise.resolve(undefined) },
        { directory: 'images', promptForPath: false, defaultAltText: 'filename' },
      ),
      (): Promise<undefined> => {
        readCalled = true;
        return Promise.resolve(undefined);
      },
    );

    await expect(provider.prepare(
      {
        documentPath: '/workspace/docs/guide.md',
        workspaceRootPath: '/workspace',
        language: 'markdown',
        isTrusted: true,
      },
      { get: (): undefined => undefined },
      { isCancellationRequested: true },
    )).resolves.toBeUndefined();
    expect(readCalled).toBe(false);
  });
});
