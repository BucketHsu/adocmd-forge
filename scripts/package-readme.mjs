import { readFile, unlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const Asciidoctor = require('@asciidoctor/core');

const canonicalReadmeName = 'README.adoc';
const packagedReadmeName = 'README.md';

/**
 * Generate the Marketplace-compatible README.md only for the duration of a
 * packaging operation. README.adoc remains the single editable source file.
 */
export async function withPackagedReadme(projectDirectory, operation) {
  const canonicalReadmePath = path.join(projectDirectory, canonicalReadmeName);
  const packagedReadmePath = path.join(projectDirectory, packagedReadmeName);
  const originalReadme = await readExistingFile(packagedReadmePath);
  const source = await readFile(canonicalReadmePath, 'utf8');
  const html = Asciidoctor().convert(source, {
    header_footer: false,
    safe: 'safe',
    standalone: false,
  });

  await writeFile(
    packagedReadmePath,
    '<!-- Generated from README.adoc for VS Code Marketplace packaging. -->\n' +
      html +
      '\n',
    'utf8',
  );

  try {
    return await operation(packagedReadmeName);
  } finally {
    await restoreFile(packagedReadmePath, originalReadme);
  }
}

async function readExistingFile(filePath) {
  try {
    return await readFile(filePath);
  } catch (error) {
    if (isMissingFile(error)) {
      return undefined;
    }
    throw error;
  }
}

async function restoreFile(filePath, originalContents) {
  if (originalContents === undefined) {
    await unlink(filePath);
    return;
  }
  await writeFile(filePath, originalContents);
}

function isMissingFile(error) {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
