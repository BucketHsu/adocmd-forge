import type { ImageService } from './imageService';
import {
  readImageSourceFromTransfer,
  type ImageTransfer,
  type ImageTransferUriReader,
} from './imageDataTransfer';
import type {
  ImageDocumentContext,
  ImageOperation,
} from './imageTypes';

export interface ImageCancellationToken {
  isCancellationRequested: boolean;
}

export class ImageDropProvider {
  public constructor(
    private readonly imageService: ImageService,
    private readonly readUri: ImageTransferUriReader,
  ) {}

  public async prepare(
    context: ImageDocumentContext,
    transfer: ImageTransfer,
    token: ImageCancellationToken,
  ): Promise<ImageOperation | undefined> {
    if (token.isCancellationRequested) {
      return undefined;
    }

    const source = await readImageSourceFromTransfer(transfer, this.readUri);
    if (source === undefined || isCancelled(token)) {
      return undefined;
    }

    const operation = await this.imageService.prepare(context, source);
    return isCancelled(token) ? undefined : operation;
  }
}

function isCancelled(token: ImageCancellationToken): boolean {
  return token.isCancellationRequested;
}
