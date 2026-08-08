import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createVSIX } from '@vscode/vsce';

import { withPackagedReadme } from './package-readme.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(scriptDirectory, '..');
const manifestPath = path.join(projectDirectory, 'package.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

if (
  typeof manifest.name !== 'string' ||
  typeof manifest.version !== 'string'
) {
  throw new TypeError('package.json must contain string name and version fields.');
}

const artifactDirectory = path.join(projectDirectory, 'artifacts');
const packagePath = path.join(
  artifactDirectory,
  `${manifest.name}-${manifest.version}.vsix`,
);

await mkdir(artifactDirectory, {
  recursive: true,
});

await withPackagedReadme(projectDirectory, (readmePath) =>
  createVSIX({
    cwd: projectDirectory,
    dependencies: false,
    packagePath,
    readmePath,
  }),
);
