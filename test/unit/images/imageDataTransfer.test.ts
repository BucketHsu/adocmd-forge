import { describe, expect, it } from 'vitest';

import { readImageSourceFromTransfer } from '../../../src/images/imageDataTransfer';

function createFileItem(
  name: string,
  data: Uint8Array,
): { asFile: () => { readonly name: string; data: () => Promise<Uint8Array> } } {
  return {
    asFile: () => ({
      name,
      data: (): Promise<Uint8Array> => Promise.resolve(data),
    }),
  };
}

describe('image data transfer extraction', (): void => {
  it('reads a supported image MIME payload', async (): Promise<void> => {
    const data = new Uint8Array([1, 2, 3]);
    const result = await readImageSourceFromTransfer({
      get: () => undefined,
      entries: () => [['image/png', createFileItem('diagram.png', data)]],
    }, (): Promise<undefined> => Promise.resolve(undefined));

    expect(result).toEqual({
      name: 'diagram.png',
      mimeType: 'image/png',
      data,
    });
  });

  it('reads a file payload and a URI list payload', async (): Promise<void> => {
    const fileData = new Uint8Array([4]);
    const fileResult = await readImageSourceFromTransfer({
      get: (mimeType) => mimeType === 'files'
        ? createFileItem('from-file.webp', fileData)
        : undefined,
    }, (): Promise<undefined> => Promise.resolve(undefined));
    expect(fileResult?.name).toBe('from-file.webp');

    const uriData = new Uint8Array([5]);
    const uriResult = await readImageSourceFromTransfer({
      get: (mimeType) => {
        if (mimeType !== 'text/uri-list') {
          return undefined;
        }
        return {
          asString: (): Promise<string> => Promise.resolve(
            '# comment\nfile:///tmp/diagram.jpg\n',
          ),
        };
      },
    }, (uri): Promise<{ readonly name: string; readonly data: Uint8Array } | undefined> => (
      Promise.resolve(uri === 'file:///tmp/diagram.jpg'
        ? { name: 'diagram.jpg', data: uriData }
        : undefined)
    ));

    expect(uriResult).toEqual({
      name: 'diagram.jpg',
      data: uriData,
    });
  });

  it('returns undefined for empty or non-file transfer data', async (): Promise<void> => {
    const result = await readImageSourceFromTransfer({
      get: () => ({
        asString: (): Promise<string> => Promise.resolve('# only a comment'),
      }),
    }, (): Promise<undefined> => Promise.resolve(undefined));

    expect(result).toBeUndefined();
  });
});
