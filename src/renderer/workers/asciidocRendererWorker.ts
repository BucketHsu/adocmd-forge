import { parentPort } from 'node:worker_threads';

import { renderAsciiDoc } from '../asciidocRenderer';
import { finalizeRenderedDocument } from '../renderFinalizer';
import { startRendererWorker } from '../rendererWorkerRuntime';

startRendererWorker(parentPort, (request) => (
  finalizeRenderedDocument(
    renderAsciiDoc(request),
    request.source,
  )
));
