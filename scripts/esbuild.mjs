import { rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { build, context } from 'esbuild';

const watch = process.argv.includes('--watch');
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(scriptDirectory, '..');
const outputDirectory = path.join(projectDirectory, 'dist');

await rm(outputDirectory, {
  force: true,
  recursive: true,
});

const sharedOptions = {
  bundle: true,
  legalComments: 'external',
  logLevel: 'info',
  minify: !watch,
  sourcemap: watch,
};

const extensionOptions = {
  ...sharedOptions,
  entryPoints: [
    path.join(projectDirectory, 'src', 'extension.ts'),
  ],
  external: [
    'vscode',
  ],
  format: 'cjs',
  outfile: path.join(outputDirectory, 'extension.js'),
  platform: 'node',
  target: 'node20',
};

const markdownWorkerOptions = {
  ...sharedOptions,
  entryPoints: [
    path.join(
      projectDirectory,
      'src',
      'renderer',
      'workers',
      'markdownRendererWorker.ts',
    ),
  ],
  format: 'cjs',
  outfile: path.join(
    outputDirectory,
    'workers',
    'markdownRenderer.js',
  ),
  platform: 'node',
  target: 'node20',
};

const asciidocWorkerOptions = {
  ...sharedOptions,
  entryPoints: [
    path.join(
      projectDirectory,
      'src',
      'renderer',
      'workers',
      'asciidocRendererWorker.ts',
    ),
  ],
  format: 'cjs',
  outfile: path.join(
    outputDirectory,
    'workers',
    'asciidocRenderer.js',
  ),
  platform: 'node',
  target: 'node20',
};

const webviewOptions = {
  ...sharedOptions,
  entryPoints: [
    path.join(projectDirectory, 'src', 'webview', 'preview.ts'),
  ],
  format: 'esm',
  outfile: path.join(outputDirectory, 'media', 'preview.js'),
  platform: 'browser',
  target: 'es2022',
};

if (watch) {
  const buildContexts = await Promise.all([
    context(extensionOptions),
    context(markdownWorkerOptions),
    context(asciidocWorkerOptions),
    context(webviewOptions),
  ]);
  await Promise.all(buildContexts.map(
    async (buildContext) => buildContext.watch(),
  ));
} else {
  await Promise.all([
    build(extensionOptions),
    build(markdownWorkerOptions),
    build(asciidocWorkerOptions),
    build(webviewOptions),
  ]);
}
