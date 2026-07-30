import { EventEmitter } from 'node:events';

import {
  describe,
  expect,
  it,
} from 'vitest';

import type { DocumentKind } from '../../../src/models/documentKind';
import type { RenderRequest } from '../../../src/models/renderRequest';
import type { RenderResult } from '../../../src/models/renderResult';
import {
  RenderCancelledError,
  RendererWorkerService,
  type RendererWorkerFactory,
  type RendererWorkerHandle,
} from '../../../src/services/rendererWorkerService';
import type {
  RendererWorkerRequestMessage,
  RendererWorkerResponseMessage,
} from '../../../src/renderer/workerProtocol';

const MARKDOWN_REQUEST: RenderRequest = {
  kind: 'markdown',
  source: '# Document',
};
const MARKDOWN_RESULT = {
  html: '<h1>Document</h1>',
  lineCount: 1,
} as const;

describe('RendererWorkerService', (): void => {
  it('creates one lazy Worker per format and processes each lane sequentially', async (): Promise<void> => {
    const harness = createWorkerHarness();
    const service = new RendererWorkerService(harness.factory);

    expect(harness.createdWorkers).toHaveLength(0);
    const firstRender = service.render(MARKDOWN_REQUEST);
    const secondRender = service.render({
      kind: 'markdown',
      source: 'Second',
    });

    expect(harness.createdWorkers).toHaveLength(1);
    const markdownWorker = harness.createdWorkers[0];
    expect(markdownWorker?.postedMessages).toHaveLength(1);
    markdownWorker?.respondWithResult(0, MARKDOWN_RESULT);
    await expect(firstRender).resolves.toEqual(MARKDOWN_RESULT);

    expect(markdownWorker?.postedMessages).toHaveLength(2);
    markdownWorker?.respondWithResult(1, {
      html: '<p>Second</p>',
      lineCount: 1,
    });
    await expect(secondRender).resolves.toEqual({
      html: '<p>Second</p>',
      lineCount: 1,
    });

    const asciidocRender = service.render({
      kind: 'asciidoc',
      source: '= Document',
    });
    expect(harness.createdWorkers).toHaveLength(2);
    const asciidocWorker = harness.createdWorkers[1];
    asciidocWorker?.respondWithResult(0, {
      html: '<h1>Document</h1>',
      lineCount: 1,
      title: 'Document',
    });
    await expect(asciidocRender).resolves.toMatchObject({
      title: 'Document',
    });

    await service.shutdown();
    expect(markdownWorker?.terminateCalls).toBe(1);
    expect(asciidocWorker?.terminateCalls).toBe(1);
  });

  it('removes an aborted queued render without terminating the active Worker', async (): Promise<void> => {
    const harness = createWorkerHarness();
    const service = new RendererWorkerService(harness.factory);
    const activeRender = service.render(MARKDOWN_REQUEST);
    const controller = new AbortController();
    const queuedRender = service.render({
      kind: 'markdown',
      source: 'Queued',
    }, controller.signal);
    const queuedExpectation = expect(queuedRender).rejects.toBeInstanceOf(
      RenderCancelledError,
    );

    controller.abort();
    await queuedExpectation;
    const worker = harness.createdWorkers[0];
    expect(worker?.terminateCalls).toBe(0);
    expect(worker?.postedMessages).toHaveLength(1);

    worker?.respondWithResult(0, MARKDOWN_RESULT);
    await expect(activeRender).resolves.toEqual(MARKDOWN_RESULT);
    await service.shutdown();
  });

  it('terminates an active cancelled Worker and continues queued work on a new generation', async (): Promise<void> => {
    const harness = createWorkerHarness();
    const service = new RendererWorkerService(harness.factory);
    const controller = new AbortController();
    const cancelledRender = service.render(
      MARKDOWN_REQUEST,
      controller.signal,
    );
    const cancelledExpectation = expect(cancelledRender).rejects.toBeInstanceOf(
      RenderCancelledError,
    );
    const queuedRender = service.render({
      kind: 'markdown',
      source: 'Newest',
    });
    const firstWorker = harness.createdWorkers[0];

    controller.abort();
    await cancelledExpectation;
    await waitForMicrotasks();

    expect(firstWorker?.terminateCalls).toBe(1);
    expect(harness.createdWorkers).toHaveLength(2);
    const replacementWorker = harness.createdWorkers[1];
    expect(replacementWorker?.postedMessages).toHaveLength(1);

    firstWorker?.respondWithResult(0, MARKDOWN_RESULT);
    replacementWorker?.respondWithResult(1, {
      html: '<p>Newest</p>',
      lineCount: 1,
    });
    await expect(queuedRender).resolves.toMatchObject({
      html: '<p>Newest</p>',
    });
    await service.shutdown();
  });

  it('rejects renderer errors without discarding the reusable Worker', async (): Promise<void> => {
    const harness = createWorkerHarness();
    const service = new RendererWorkerService(harness.factory);
    const failedRender = service.render(MARKDOWN_REQUEST);
    const worker = harness.createdWorkers[0];

    worker?.respondWithError(0, 'RendererFailure', 'Invalid document');
    await expect(failedRender).rejects.toMatchObject({
      message: 'Invalid document',
      name: 'RendererFailure',
    });

    const nextRender = service.render(MARKDOWN_REQUEST);
    expect(harness.createdWorkers).toHaveLength(1);
    worker?.respondWithResult(1, MARKDOWN_RESULT);
    await expect(nextRender).resolves.toEqual(MARKDOWN_RESULT);
    await service.shutdown();
  });

  it.each([
    'invalid-message',
    'message-error',
    'worker-error',
    'worker-exit',
  ] as const)('rejects active and queued work after %s', async (failureKind): Promise<void> => {
    const harness = createWorkerHarness();
    const service = new RendererWorkerService(harness.factory);
    const activeRender = service.render(MARKDOWN_REQUEST);
    const queuedRender = service.render(MARKDOWN_REQUEST);
    const activeExpectation = expect(activeRender).rejects.toBeInstanceOf(Error);
    const queuedExpectation = expect(queuedRender).rejects.toBeInstanceOf(Error);
    const worker = harness.createdWorkers[0];

    switch (failureKind) {
      case 'invalid-message':
        worker?.emit('message', {
          invalid: true,
        });
        break;
      case 'message-error':
        worker?.emit('messageerror', new Error('Clone failed'));
        break;
      case 'worker-error':
        worker?.emit('error', new Error('Worker crashed'));
        break;
      case 'worker-exit':
        worker?.emit('exit', 9);
        break;
    }

    await activeExpectation;
    await queuedExpectation;
    expect(worker?.terminateCalls).toBe(1);

    const recoveryRender = service.render(MARKDOWN_REQUEST);
    const replacementWorker = harness.createdWorkers[1];
    replacementWorker?.respondWithResult(1, MARKDOWN_RESULT);
    await expect(recoveryRender).resolves.toEqual(MARKDOWN_RESULT);
    await service.shutdown();
  });

  it('rejects unexpected response ids as a protocol failure', async (): Promise<void> => {
    const harness = createWorkerHarness();
    const service = new RendererWorkerService(harness.factory);
    const render = service.render(MARKDOWN_REQUEST);
    const expectation = expect(render).rejects.toThrow(
      'unexpected request id',
    );

    harness.createdWorkers[0]?.respondWithResult(99, MARKDOWN_RESULT);

    await expectation;
    await service.shutdown();
  });

  it('rejects pre-aborted signals, creation failures, and calls after disposal', async (): Promise<void> => {
    const preAbortedController = new AbortController();
    preAbortedController.abort();
    const unusedHarness = createWorkerHarness();
    const service = new RendererWorkerService(unusedHarness.factory);

    await expect(
      service.render(MARKDOWN_REQUEST, preAbortedController.signal),
    ).rejects.toBeInstanceOf(RenderCancelledError);
    expect(unusedHarness.createdWorkers).toHaveLength(0);

    const failingService = new RendererWorkerService(() => {
      throw new Error('Worker unavailable');
    });
    await expect(failingService.render(MARKDOWN_REQUEST)).rejects.toThrow(
      'Worker unavailable',
    );

    service.dispose();
    service.dispose();
    await expect(service.render(MARKDOWN_REQUEST)).rejects.toThrow(
      'already been disposed',
    );
    await failingService.shutdown();
  });
});

interface WorkerHarness {
  readonly createdKinds: DocumentKind[];
  readonly createdWorkers: FakeRendererWorker[];
  readonly factory: RendererWorkerFactory;
}

function createWorkerHarness(): WorkerHarness {
  const createdKinds: DocumentKind[] = [];
  const createdWorkers: FakeRendererWorker[] = [];
  return {
    createdKinds,
    createdWorkers,
    factory: (kind): FakeRendererWorker => {
      const worker = new FakeRendererWorker();
      createdKinds.push(kind);
      createdWorkers.push(worker);
      return worker;
    },
  };
}

class FakeRendererWorker
  extends EventEmitter
  implements RendererWorkerHandle {
  public readonly postedMessages: RendererWorkerRequestMessage[] = [];
  public terminateCalls = 0;

  public postMessage(message: RendererWorkerRequestMessage): void {
    this.postedMessages.push(message);
  }

  public terminate(): Promise<number> {
    this.terminateCalls += 1;
    return Promise.resolve(0);
  }

  public respondWithResult(
    id: number,
    result: RenderResult,
  ): void {
    this.emit('message', {
      id,
      result,
      type: 'result',
    } satisfies RendererWorkerResponseMessage);
  }

  public respondWithError(
    id: number,
    name: string,
    message: string,
  ): void {
    this.emit('message', {
      error: {
        message,
        name,
      },
      id,
      type: 'error',
    } satisfies RendererWorkerResponseMessage);
  }
}

async function waitForMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
