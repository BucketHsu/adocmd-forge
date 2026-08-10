import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { listFiles, PackageManager } from '@vscode/vsce';

import { withPackagedReadme } from './package-readme.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(scriptDirectory, '..');
const expectedPackageFiles = new Set([
  'CHANGELOG.md',
  'LICENSE',
  'README.md',
  'dist/extension.js',
  'dist/extension.js.LEGAL.txt',
  'dist/media/preview.css',
  'dist/media/preview.js',
  'dist/workers/asciidocRenderer.js',
  'dist/workers/asciidocRenderer.js.LEGAL.txt',
  'dist/workers/markdownRenderer.js',
  'dist/workers/markdownRenderer.js.LEGAL.txt',
  'images/icon.png',
  'language-configuration.json',
  'package.json',
  'snippets/asciidoc.json',
  'syntaxes/asciidoc.tmLanguage.json',
]);

await withPackagedReadme(projectDirectory, async () => {
  const files = await listFiles({
    cwd: projectDirectory,
    packageManager: PackageManager.None,
    readmePath: 'README.md',
  });
  const packagedFiles = new Set(files);
  const missingFiles = [...expectedPackageFiles].filter(
    (file) => !packagedFiles.has(file),
  );
  const unexpectedFiles = files.filter(
    (file) => !expectedPackageFiles.has(file),
  );
  if (missingFiles.length > 0 || unexpectedFiles.length > 0) {
    throw new Error([
      'VSIX contents do not match the Marketplace allowlist.',
      `Missing: ${missingFiles.join(', ') || '(none)'}`,
      `Unexpected: ${unexpectedFiles.join(', ') || '(none)'}`,
    ].join('\n'));
  }

  console.log(files.join('\n'));
});
