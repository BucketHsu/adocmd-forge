import assert from 'node:assert/strict';

import * as vscode from 'vscode';

const OPEN_PREVIEW_COMMAND = 'adocmdForge.openPreview';
const PREVIEW_VIEW_TYPE = 'adocmdForge.preview';
const REFRESH_PREVIEW_COMMAND = 'adocmdForge.refreshPreview';

export async function activateExtensionTest(): Promise<void> {
  const extension = vscode.extensions.getExtension('BucketHsu.adocmd-forge');

  assert.ok(extension, 'The Extension Host did not discover AdocMD Forge.');
  assert.equal(extension.isActive, false, 'The extension activated too early.');

  const document = await vscode.workspace.openTextDocument({
    content: '# Integration test',
    language: 'markdown',
  });
  await vscode.window.showTextDocument(document);

  await waitUntilActive(extension);
  assert.equal(extension.isActive, true);

  const registeredCommands = await vscode.commands.getCommands(true);
  assert.ok(registeredCommands.includes(OPEN_PREVIEW_COMMAND));
  assert.ok(registeredCommands.includes(REFRESH_PREVIEW_COMMAND));

  await vscode.commands.executeCommand(OPEN_PREVIEW_COMMAND);
  await waitUntilPreviewTabCount(1);
  await vscode.commands.executeCommand(OPEN_PREVIEW_COMMAND);
  await waitUntilPreviewTabCount(1);

  const activeEditor = vscode.window.activeTextEditor;
  assert.ok(activeEditor, 'The Markdown editor unexpectedly lost focus.');
  const lastLine = activeEditor.document.lineAt(
    activeEditor.document.lineCount - 1,
  );
  await activeEditor.edit((editBuilder) => {
    editBuilder.insert(
      lastLine.range.end,
      '\n\nLive update',
    );
  });
  await delay(350);
  await vscode.commands.executeCommand(REFRESH_PREVIEW_COMMAND);

  const previewTab = getPreviewTabs()[0];
  assert.ok(previewTab, 'The preview tab disappeared before close testing.');
  assert.equal(await vscode.window.tabGroups.close(previewTab), true);
  await waitUntilPreviewTabCount(0);

  await vscode.commands.executeCommand(OPEN_PREVIEW_COMMAND);
  await waitUntilPreviewTabCount(1);

  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
}

async function waitUntilActive(
  extension: vscode.Extension<unknown>,
): Promise<void> {
  const timeoutAt = Date.now() + 5_000;

  while (!extension.isActive && Date.now() < timeoutAt) {
    await delay(25);
  }

  assert.equal(
    extension.isActive,
    true,
    'Opening a Markdown document did not activate the extension.',
  );
}

async function waitUntilPreviewTabCount(expectedCount: number): Promise<void> {
  const timeoutAt = Date.now() + 5_000;

  while (getPreviewTabs().length !== expectedCount && Date.now() < timeoutAt) {
    await delay(25);
  }

  assert.equal(
    getPreviewTabs().length,
    expectedCount,
    `Expected ${String(expectedCount)} AdocMD Forge Webview tab(s). `
    + `Open tabs: ${describeOpenTabs()}`,
  );
}

function getPreviewTabs(): vscode.Tab[] {
  return vscode.window.tabGroups.all.flatMap(({ tabs }) => (
    tabs.filter(({ input }) => (
      isWebviewInput(input)
      && (
        input.viewType === PREVIEW_VIEW_TYPE
        || input.viewType === `mainThreadWebview-${PREVIEW_VIEW_TYPE}`
      )
    ))
  ));
}

function describeOpenTabs(): string {
  return JSON.stringify(vscode.window.tabGroups.all.flatMap(({ tabs }) => (
    tabs.map(({ input, label }) => ({
      inputType: Object.prototype.toString.call(input),
      label,
      viewType: isWebviewInput(input) ? input.viewType : undefined,
    }))
  )));
}

function isWebviewInput(
  input: unknown,
): input is vscode.TabInputWebview {
  return typeof input === 'object'
    && input !== null
    && 'viewType' in input
    && typeof input.viewType === 'string';
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve): void => {
    setTimeout(resolve, milliseconds);
  });
}
