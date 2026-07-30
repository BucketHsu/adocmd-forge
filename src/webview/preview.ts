/// <reference lib="dom" />

import '../../media/preview.css';

import {
  initializePreview,
  type PreviewRuntime,
} from './previewRuntime';

function startPreview(): void {
  const runtime: PreviewRuntime | undefined = initializePreview();
  if (runtime !== undefined) {
    window.addEventListener('pagehide', (): void => {
      runtime.dispose();
    }, {
      once: true,
    });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startPreview, {
    once: true,
  });
} else {
  startPreview();
}
