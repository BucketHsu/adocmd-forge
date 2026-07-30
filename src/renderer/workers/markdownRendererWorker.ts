import { parentPort } from 'node:worker_threads';

import { renderMarkdown } from '../markdownRenderer';
import { finalizeRenderedDocument } from '../renderFinalizer';
import { startRendererWorker } from '../rendererWorkerRuntime';

startRendererWorker(parentPort, (request) => (
  finalizeRenderedDocument(
    renderMarkdown(request.source),
    request.source,
  )
));
