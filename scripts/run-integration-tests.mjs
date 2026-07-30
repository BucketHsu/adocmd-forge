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

try {
  await runTests({
    extensionDevelopmentPath,
    extensionTestsPath,
    launchArgs: [
      '--disable-extensions',
      '--skip-release-notes',
      '--skip-welcome',
    ],
    version: '1.96.2',
  });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Extension Host integration tests failed: ${message}\n`);
  process.exitCode = 1;
}
