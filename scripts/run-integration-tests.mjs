import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runTests } from '@vscode/test-electron';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const extensionDevelopmentPath = path.resolve(scriptDirectory, '..');
const extensionTestsPath = path.resolve(
  extensionDevelopmentPath,
  'dist',
  'test',
  'integration',
  'suite',
  'index.js',
);
const userDataDirectory = await mkdtemp(
  path.join(os.tmpdir(), 'adocmd-forge-vscode-user-'),
);
const workspaceDirectory = await mkdtemp(
  path.join(os.tmpdir(), 'adocmd-forge-vscode-workspace-'),
);
const workspaceFile = path.join(
  workspaceDirectory,
  'adocmd-forge-integration.code-workspace',
);
await writeFile(workspaceFile, JSON.stringify({
  folders: [{ path: '.' }],
}));

try {
  await runTests({
    extensionDevelopmentPath,
    extensionTestsPath,
    launchArgs: [
      workspaceFile,
      '--disable-extensions',
      '--disable-gpu',
      '--skip-release-notes',
      '--skip-welcome',
      `--user-data-dir=${userDataDirectory}`,
    ],
    version: '1.97.2',
  });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Extension Host integration tests failed: ${message}\n`);
  process.exitCode = 1;
} finally {
  for (const directory of [userDataDirectory, workspaceDirectory]) {
    try {
      await rm(directory, { force: true, recursive: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`Integration temporary-directory cleanup failed: ${message}\n`);
      process.exitCode = 1;
    }
  }
}
