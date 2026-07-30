import type { MessagePort } from 'node:worker_threads';

import type { RenderRequest } from '../models/renderRequest';
import type { RenderResult } from '../models/renderResult';
import { getErrorMessage } from '../utility/errorMessage';
import {
  isRendererWorkerRequestMessage,
  type RendererWorkerResponseMessage,
} from './workerProtocol';

export type WorkerDocumentRenderer = (
  request: RenderRequest,
) => Promise<RenderResult> | RenderResult;

/**
 * 啟動單一格式的 renderer Worker 訊息迴圈。
 */
export function startRendererWorker(
  parentPort: MessagePort | null,
  renderer: WorkerDocumentRenderer,
): void {
  if (parentPort === null) {
    throw new Error('Renderer worker requires a parent message port.');
  }

  parentPort.on('message', (message: unknown) => {
    if (!isRendererWorkerRequestMessage(message)) {
      throw new Error('Renderer worker received an invalid request.');
    }

    void Promise.resolve()
      .then(() => renderer(message.request))
      .then(
        (result): void => {
          const response = {
            id: message.id,
            result,
            type: 'result',
          } satisfies RendererWorkerResponseMessage;
          parentPort.postMessage(response);
        },
        (error: unknown): void => {
          const response = {
            error: {
              message: getErrorMessage(error),
              name: getErrorName(error),
            },
            id: message.id,
            type: 'error',
          } satisfies RendererWorkerResponseMessage;
          parentPort.postMessage(response);
        },
      );
  });
}

function getErrorName(error: unknown): string {
  return error instanceof Error && error.name.length > 0
    ? error.name
    : 'Error';
}
