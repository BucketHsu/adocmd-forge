import type { ImageSource } from './imageTypes';

export interface ImageTransferFile {
  readonly name: string;
  readonly data: () => Promise<Uint8Array>;
}

export interface ImageTransferItem {
  readonly asFile?: () => ImageTransferFile | undefined;
  readonly asString?: () => Promise<string>;
}

export interface ImageTransfer {
  get(mimeType: string): ImageTransferItem | undefined;
  entries?(): Iterable<readonly [string, ImageTransferItem]>;
}

export type ImageTransferUriReader = (
  uri: string,
) => Promise<{ readonly name: string; readonly data: Uint8Array } | undefined>;

export async function readImageSourceFromTransfer(
  transfer: ImageTransfer,
  readUri: ImageTransferUriReader,
): Promise<ImageSource | undefined> {
  const imageEntries = getEntries(transfer)
    .filter(([mimeType]) => mimeType.toLowerCase().startsWith('image/'));

  for (const [mimeType, item] of imageEntries) {
    const file = item.asFile?.();
    if (file !== undefined) {
      return {
        name: file.name,
        mimeType,
        data: await file.data(),
      };
    }
  }

  const filesItem = transfer.get('files');
  const file = filesItem?.asFile?.();
  if (file !== undefined) {
    return {
      name: file.name,
      data: await file.data(),
    };
  }

  const uriItem = transfer.get('text/uri-list');
  const uriText = await uriItem?.asString?.();
  const uri = getFirstUri(uriText);
  if (uri === undefined) {
    return undefined;
  }

  const readResult = await readUri(uri);
  if (readResult === undefined) {
    return undefined;
  }

  return {
    name: readResult.name,
    data: readResult.data,
  };
}

function getEntries(
  transfer: ImageTransfer,
): readonly (readonly [string, ImageTransferItem])[] {
  if (transfer.entries !== undefined) {
    return [...transfer.entries()];
  }

  return [];
}

function getFirstUri(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  for (const line of value.split(/\r?\n/u)) {
    const candidate = line.trim();
    if (candidate.length > 0 && !candidate.startsWith('#')) {
      return candidate;
    }
  }

  return undefined;
}
