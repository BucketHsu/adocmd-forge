import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { listFiles, PackageManager } from '@vscode/vsce';

import { withPackagedReadme } from './package-readme.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(scriptDirectory, '..');

await withPackagedReadme(projectDirectory, async () => {
  const files = await listFiles({
    cwd: projectDirectory,
    packageManager: PackageManager.None,
    readmePath: 'README.md',
  });
  console.log(files.join('\n'));
});
