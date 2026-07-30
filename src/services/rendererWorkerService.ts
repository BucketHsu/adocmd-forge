import { Worker } from 'node:worker_threads';

import type { DocumentKind } from '../models/documentKind';
import type { RenderRequest } from '../models/renderRequest';
import type { RenderResult } from '../models/renderResult';
import {
  isRendererWorkerResponseMessage,
  type RendererWorkerRequestMessage,
} from '../renderer/workerProtocol';

export interface RendererWorkerPaths {
  readonly asciidoc: string;
  readonly markdown: string;
}

export interface RendererWorkerHandle {
  off(
    event: 'error' | 'messageerror',
    listener: (error: Error) => void,
  ): this;
  off(event: 'exit', listener: (exitCode: number) => void): this;
  off(event: 'message', listener: (message: unknown) => void): this;
  on(
    event: 'error' | 'messageerror',
    listener: (error: Error) => void,
  ): this;
  on(event: 'exit', listener: (exitCode: number) => void): this;
  on(event: 'message', listener: (message: unknown) => void): this;
  postMessage(message: RendererWorkerRequestMessage): void;
  terminate(): Promise<number>;
}

export type RendererWorkerFactory = (
  kind: DocumentKind,
) => RendererWorkerHandle;

interface RenderJob {
  readonly reject: (error: Error) => void;
  readonly request: RenderRequest;
  readonly resolve: (result: RenderResult) => void;
  readonly signal?: AbortSignal;
  abortListener?: () => void;
  id?: number;
  settled: boolean;
}

interface WorkerListeners {
  readonly error: (error: Error) => void;
  readonly exit: (exitCode: number) => void;
  readonly message: (message: unknown) => void;
  readonly messageError: (error: Error) => void;
}

export class RenderCancelledError extends Error {
  public constructor() {
    super('Document rendering was cancelled.');
    this.name = 'RenderCancelledError';
  }
}

/**
 * 每種格式各維護一個按需建立的 Worker，避免 renderer 阻塞 Extension Host。
 */
export class RendererWorkerService {
  private disposed = false;
  private readonly lanes = new Map<DocumentKind, RendererWorkerLane>();

  public constructor(private readonly workerFactory: RendererWorkerFactory) {}

  public render(
    request: RenderRequest,
    signal?: AbortSignal,
  ): Promise<RenderResult> {
    if (this.disposed) {
      return Promise.reject(
        new Error('Renderer worker service has already been disposed.'),
      );
    }
    if (signal?.aborted === true) {
      return Promise.reject(new RenderCancelledError());
    }

    let lane = this.lanes.get(request.kind);
    if (lane === undefined) {
      lane = new RendererWorkerLane(request.kind, this.workerFactory);
      this.lanes.set(request.kind, lane);
    }
    return lane.render(request, signal);
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    for (const lane of this.lanes.values()) {
      lane.dispose();
    }
    this.lanes.clear();
  }

  public async shutdown(): Promise<void> {
    const lanes = [...this.lanes.values()];
    this.dispose();
    await Promise.all(lanes.map(async (lane) => lane.whenTerminated()));
  }
}

export function createNodeRendererWorkerFactory(
  paths: RendererWorkerPaths,
): RendererWorkerFactory {
  return (kind) => new Worker(paths[kind], {
    name: `adocmd-forge-${kind}-renderer`,
  });
}

class RendererWorkerLane {
  private activeJob: RenderJob | undefined;
  private disposed = false;
  private generation = 0;
  private listeners: WorkerListeners | undefined;
  private nextRequestId = 0;
  private readonly queuedJobs: RenderJob[] = [];
  private restartPromise: Promise<void> | undefined;
  private readonly terminationPromises = new Set<Promise<void>>();
  private worker: RendererWorkerHandle | undefined;

  public constructor(
    private readonly kind: DocumentKind,
    private readonly workerFactory: RendererWorkerFactory,
  ) {}

  public render(
    request: RenderRequest,
    signal?: AbortSignal,
  ): Promise<RenderResult> {
    return new Promise((resolve, reject) => {
      const job: RenderJob = {
        reject,
        request,
        resolve,
        ...(signal === undefined ? {} : {
          signal,
        }),
        settled: false,
      };
      if (signal !== undefined) {
        const abortListener = (): void => {
          this.cancel(job);
        };
        job.abortListener = abortListener;
        signal.addEventListener('abort', abortListener, {
          once: true,
        });
      }
      this.queuedJobs.push(job);
      this.pump();
    });
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    const error = new Error('Renderer worker lane was disposed.');
    if (this.activeJob !== undefined) {
      this.rejectJob(this.activeJob, error);
      this.activeJob = undefined;
    }
    for (const job of this.queuedJobs.splice(0)) {
      this.rejectJob(job, error);
    }
    void this.stopWorker();
  }

  public async whenTerminated(): Promise<void> {
    await Promise.all([...this.terminationPromises]);
  }

  private pump(): void {
    if (
      this.disposed
      || this.activeJob !== undefined
      || this.restartPromise !== undefined
    ) {
      return;
    }

    const job = this.queuedJobs.shift();
    if (job === undefined) {
      return;
    }
    if (job.signal?.aborted === true) {
      this.rejectJob(job, new RenderCancelledError());
      this.pump();
      return;
    }

    try {
      this.ensureWorker();
      job.id = this.createRequestId();
      this.activeJob = job;
      this.worker?.postMessage({
        id: job.id,
        request: job.request,
        type: 'render',
      });
    } catch (error) {
      this.activeJob = undefined;
      this.rejectJob(job, toError(error));
      this.failQueuedJobs(new Error(
        `Unable to start the ${this.kind} renderer worker.`,
      ));
      void this.stopWorker();
    }
  }

  private ensureWorker(): void {
    if (this.worker !== undefined) {
      return;
    }

    const generation = this.generation + 1;
    const worker = this.workerFactory(this.kind);
    const listeners: WorkerListeners = {
      error: (error): void => {
        this.handleWorkerFailure(generation, error);
      },
      exit: (exitCode): void => {
        this.handleWorkerFailure(
          generation,
          new Error(
            `${this.kind} renderer worker exited unexpectedly `
            + `with code ${String(exitCode)}.`,
          ),
        );
      },
      message: (message): void => {
        this.handleWorkerMessage(generation, message);
      },
      messageError: (error): void => {
        this.handleWorkerFailure(generation, error);
      },
    };

    worker.on('error', listeners.error);
    worker.on('exit', listeners.exit);
    worker.on('message', listeners.message);
    worker.on('messageerror', listeners.messageError);
    this.generation = generation;
    this.listeners = listeners;
    this.worker = worker;
  }

  private handleWorkerMessage(
    generation: number,
    message: unknown,
  ): void {
    if (generation !== this.generation || this.disposed) {
      return;
    }
    if (!isRendererWorkerResponseMessage(message)) {
      this.handleWorkerFailure(
        generation,
        new Error(`${this.kind} renderer worker returned an invalid message.`),
      );
      return;
    }

    const job = this.activeJob;
    if (job?.id !== message.id) {
      this.handleWorkerFailure(
        generation,
        new Error(`${this.kind} renderer worker returned an unexpected request id.`),
      );
      return;
    }

    this.activeJob = undefined;
    if (message.type === 'result') {
      this.resolveJob(job, message.result);
    } else {
      const error = new Error(message.error.message);
      error.name = message.error.name;
      this.rejectJob(job, error);
    }
    this.pump();
  }

  private handleWorkerFailure(
    generation: number,
    error: Error,
  ): void {
    if (generation !== this.generation || this.disposed) {
      return;
    }

    if (this.activeJob !== undefined) {
      this.rejectJob(this.activeJob, error);
      this.activeJob = undefined;
    }
    this.failQueuedJobs(error);
    void this.stopWorker();
  }

  private cancel(job: RenderJob): void {
    if (job.settled) {
      return;
    }

    const queuedIndex = this.queuedJobs.indexOf(job);
    if (queuedIndex >= 0) {
      this.queuedJobs.splice(queuedIndex, 1);
      this.rejectJob(job, new RenderCancelledError());
      return;
    }
    if (this.activeJob !== job) {
      return;
    }

    this.activeJob = undefined;
    this.rejectJob(job, new RenderCancelledError());
    const termination = this.stopWorker();
    this.restartPromise = termination;
    void termination.finally(() => {
      if (this.restartPromise === termination) {
        this.restartPromise = undefined;
        this.pump();
      }
    });
  }

  private stopWorker(): Promise<void> {
    const worker = this.worker;
    const listeners = this.listeners;
    this.worker = undefined;
    this.listeners = undefined;
    this.generation += 1;
    if (worker === undefined) {
      return Promise.resolve();
    }

    if (listeners !== undefined) {
      worker.off('error', listeners.error);
      worker.off('exit', listeners.exit);
      worker.off('message', listeners.message);
      worker.off('messageerror', listeners.messageError);
    }

    const termination = worker.terminate().then(
      (): void => {
        // Worker 已正常終止。
      },
      (): void => {
        // 終止失敗不應產生未處理 rejection；既有工作已在上方結清。
      },
    );
    this.terminationPromises.add(termination);
    void termination.finally(() => {
      this.terminationPromises.delete(termination);
    });
    return termination;
  }

  private createRequestId(): number {
    const requestId = this.nextRequestId;
    this.nextRequestId = requestId >= Number.MAX_SAFE_INTEGER
      ? 0
      : requestId + 1;
    return requestId;
  }

  private failQueuedJobs(error: Error): void {
    for (const job of this.queuedJobs.splice(0)) {
      this.rejectJob(job, error);
    }
  }

  private resolveJob(job: RenderJob, result: RenderResult): void {
    if (job.settled) {
      return;
    }
    job.settled = true;
    this.removeAbortListener(job);
    job.resolve(result);
  }

  private rejectJob(job: RenderJob, error: Error): void {
    if (job.settled) {
      return;
    }
    job.settled = true;
    this.removeAbortListener(job);
    job.reject(error);
  }

  private removeAbortListener(job: RenderJob): void {
    if (job.signal !== undefined && job.abortListener !== undefined) {
      job.signal.removeEventListener('abort', job.abortListener);
      delete job.abortListener;
    }
  }
}

function toError(error: unknown): Error {
  return error instanceof Error
    ? error
    : new Error('Renderer worker operation failed.');
}
