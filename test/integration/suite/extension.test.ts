import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import os from 'node:os';

import * as vscode from 'vscode';

const OPEN_PREVIEW_COMMAND = 'adocmdForge.openPreview';
const PREVIEW_VIEW_TYPE = 'adocmdForge.preview';
const REFRESH_PREVIEW_COMMAND = 'adocmdForge.refreshPreview';
const OPEN_SYNTAX_GUIDE_COMMAND = 'adocmdForge.openSyntaxGuide';
const COPY_IMAGE_COMMAND = 'adocmdForge.copyImage';
const VALIDATE_LINKS_COMMAND = 'adocmdForge.validateLinks';
const EXPORT_HTML_COMMAND = 'adocmdForge.exportHtml';
const EXPORT_STANDALONE_HTML_COMMAND = 'adocmdForge.exportStandaloneHtml';
const EXPORT_EMBEDDED_HTML_COMMAND = 'adocmdForge.exportEmbeddedHtml';
const EXPORT_PDF_COMMAND = 'adocmdForge.exportPdf';
const SHOW_FORMATTING_PALETTE_COMMAND = 'adocmdForge.showFormattingPalette';

interface ExtensionExports {
  readonly imageProviders: {
    readonly dropProviderRegistered: boolean;
    readonly pasteProviderRegistered: boolean;
  };
  readonly outline: {
    readonly viewRegistered: true;
    readonly provider: {
      readonly getAnalysis: () => {
        readonly documentUri: string;
        readonly headings: readonly {
          readonly title: string;
          readonly sourceLine: number;
        }[];
      } | undefined;
      readonly getChildren: (element?: unknown) => readonly unknown[];
      readonly getMessage: () => string;
    };
  };
  readonly diagnostics: {
    readonly collectionName: string;
    readonly provider: {
      readonly getDiagnostics: (uri: vscode.Uri) => readonly vscode.Diagnostic[];
    };
  };
  readonly export: {
    readonly commandsRegistered: true;
  };
}

interface ExtensionManifest {
  readonly engines: {
    readonly vscode: string;
  };
  readonly contributes: {
    readonly configuration: {
      readonly properties: Record<string, unknown>;
    };
  };
}

export async function activateExtensionTest(): Promise<void> {
  const extension = vscode.extensions.getExtension('BucketHsu.adocmd-forge');

  assert.ok(extension, 'The Extension Host did not discover AdocMD Forge.');
  assert.equal(extension.isActive, false, 'The extension activated too early.');

  const document = await vscode.workspace.openTextDocument({
    content: '# Integration test\n\n## Child',
    language: 'markdown',
  });
  await vscode.window.showTextDocument(document);

  await waitUntilActive(extension);
  assert.equal(extension.isActive, true);

  const extensionExports = extension.exports as ExtensionExports | undefined;
  assert.ok(extensionExports, 'The extension did not expose runtime status.');
  assert.equal(extensionExports.imageProviders.dropProviderRegistered, true);
  assert.equal(extensionExports.imageProviders.pasteProviderRegistered, true);
  assert.equal(extensionExports.outline.viewRegistered, true);
  assert.equal(extensionExports.diagnostics.collectionName, 'adocmd-forge');
  assert.equal(extensionExports.export.commandsRegistered, true);

  const registeredCommands = await vscode.commands.getCommands(true);
  assert.ok(registeredCommands.includes(OPEN_PREVIEW_COMMAND));
  assert.ok(registeredCommands.includes(REFRESH_PREVIEW_COMMAND));
  assert.ok(registeredCommands.includes('adocmdForge.previewSource'));
  assert.ok(registeredCommands.includes('adocmdForge.previewSplit'));
  assert.ok(registeredCommands.includes('adocmdForge.previewOnly'));
  assert.ok(registeredCommands.includes('adocmdForge.formatBold'));
  assert.ok(registeredCommands.includes('adocmdForge.formatItalic'));
  assert.ok(registeredCommands.includes('adocmdForge.formatHighlight'));
  assert.ok(registeredCommands.includes('adocmdForge.formatCode'));
  assert.ok(registeredCommands.includes('adocmdForge.formatStrike'));
  assert.ok(registeredCommands.includes('adocmdForge.formatSuperscript'));
  assert.ok(registeredCommands.includes('adocmdForge.formatSubscript'));
  assert.ok(registeredCommands.includes(SHOW_FORMATTING_PALETTE_COMMAND));
  assert.ok(registeredCommands.includes(OPEN_SYNTAX_GUIDE_COMMAND));
  assert.ok(registeredCommands.includes(COPY_IMAGE_COMMAND));
  assert.ok(registeredCommands.includes('adocmdForge.refreshOutline'));
  assert.ok(registeredCommands.includes('adocmdForge.revealOutline'));
  assert.ok(registeredCommands.includes(VALIDATE_LINKS_COMMAND));
  assert.ok(registeredCommands.includes(EXPORT_HTML_COMMAND));
  assert.ok(registeredCommands.includes(EXPORT_STANDALONE_HTML_COMMAND));
  assert.ok(registeredCommands.includes(EXPORT_EMBEDDED_HTML_COMMAND));
  assert.ok(registeredCommands.includes(EXPORT_PDF_COMMAND));
  const manifest = extension.packageJSON as ExtensionManifest;
  assert.equal(manifest.engines.vscode, '^1.97.0');
  assert.ok(
    Object.hasOwn(
      manifest.contributes.configuration.properties,
      'adocmdForge.images.directory',
    ),
  );
  assert.ok(
    Object.hasOwn(
      manifest.contributes.configuration.properties,
      'adocmdForge.diagnostics.updateDelay',
    ),
  );

  await vscode.commands.executeCommand(VALIDATE_LINKS_COMMAND);
  assert.deepEqual(
    extensionExports.diagnostics.provider.getDiagnostics(document.uri),
    [],
    'Untitled integration document should not access local link targets.',
  );

  await waitUntilOutlineAnalysis(
    extensionExports,
    document.uri.toString(),
    ['Integration test', 'Child'],
  );
  const outlineRoot = extensionExports.outline.provider.getChildren()[0];
  assert.ok(outlineRoot, 'Outline did not expose a root node.');
  await vscode.commands.executeCommand('adocmdForge.revealOutline', outlineRoot);
  assert.equal(vscode.window.activeTextEditor?.selection.active.line, 0);

  const updatedVersion = extensionExports.outline.provider.getAnalysis()?.headings;
  assert.equal(updatedVersion?.length, 2);

  await verifyAsciiDocLanguageProviders(extensionExports);
  await verifyFormattingCommands();
  await vscode.window.showTextDocument(document);
  await verifyHtmlExports();
  await vscode.window.showTextDocument(document);

  await vscode.commands.executeCommand(OPEN_PREVIEW_COMMAND);
  await waitUntilPreviewTabCount(1);
  await vscode.commands.executeCommand(OPEN_PREVIEW_COMMAND);
  await waitUntilPreviewTabCount(1);
  await vscode.commands.executeCommand('adocmdForge.previewOnly');
  await waitUntilPreviewTabCount(1);
  await vscode.commands.executeCommand('adocmdForge.previewSplit');
  await waitUntilPreviewTabCount(1);
  await vscode.commands.executeCommand('adocmdForge.previewSource');
  await waitUntilPreviewTabCount(0);
  await vscode.commands.executeCommand('adocmdForge.previewSplit');
  await waitUntilPreviewTabCount(1);

  const activeEditor = vscode.window.activeTextEditor;
  assert.ok(activeEditor, 'The Markdown editor unexpectedly lost focus.');
  const caretPosition = new vscode.Position(
    activeEditor.document.lineCount - 1,
    0,
  );
  activeEditor.selection = new vscode.Selection(caretPosition, caretPosition);
  await delay(50);
  assert.equal(
    activeEditor.selection.active.line,
    activeEditor.document.lineCount - 1,
    'Moving the source caret while previewing changed the editor selection.',
  );
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

async function verifyFormattingCommands(): Promise<void> {
  const formattingDocument = await vscode.workspace.openTextDocument({
    content: '粗體文字',
    language: 'markdown',
  });
  const editor = await vscode.window.showTextDocument(formattingDocument);
  editor.selection = new vscode.Selection(
    new vscode.Position(0, 0),
    new vscode.Position(0, formattingDocument.getText().length),
  );

  await vscode.commands.executeCommand('adocmdForge.formatBold');
  assert.equal(formattingDocument.getText(), '**粗體文字**');

  await vscode.commands.executeCommand('adocmdForge.formatItalic');
  assert.equal(formattingDocument.getText(), '***粗體文字***');
}

async function verifyHtmlExports(): Promise<void> {
  const root = vscode.Uri.joinPath(
    vscode.Uri.file(os.tmpdir()),
    `adocmd-forge-export-${String(process.pid)}-${String(Date.now())}-${randomUUID()}`,
  );
  await vscode.workspace.fs.createDirectory(root);
  const added = vscode.workspace.updateWorkspaceFolders(0, 0, {
    name: 'AdocMD Forge Export Integration',
    uri: root,
  });
  assert.equal(added, true, 'Could not add the export integration workspace folder.');

  try {
    const sourceUri = vscode.Uri.joinPath(root, 'guide.md');
    await vscode.workspace.fs.writeFile(
      sourceUri,
      new TextEncoder().encode('# Export 標題\n\n內容'),
    );
    const source = await vscode.workspace.openTextDocument(sourceUri);
    await vscode.window.showTextDocument(source);
    for (const [command, fileName] of [
      [EXPORT_HTML_COMMAND, 'html.html'],
      [EXPORT_STANDALONE_HTML_COMMAND, 'standalone.html'],
      [EXPORT_EMBEDDED_HTML_COMMAND, 'embedded.html'],
    ] as const) {
      const destination = vscode.Uri.joinPath(root, fileName);
      await vscode.commands.executeCommand(command, destination);
      const content = new TextDecoder().decode(
        await vscode.workspace.fs.readFile(destination),
      );
      if (command === EXPORT_EMBEDDED_HTML_COMMAND) {
        assert.equal(content.includes('<!doctype html>'), false);
        assert.equal(content.includes('<h1'), true);
      } else {
        assert.equal(content.includes('<!doctype html>'), true);
        assert.equal(content.includes('<meta charset="utf-8">'), true);
      }
    }
  } finally {
    vscode.workspace.updateWorkspaceFolders(0, 1);
    await vscode.workspace.fs.delete(root, { recursive: true, useTrash: false });
  }
}

async function verifyAsciiDocLanguageProviders(
  extensionExports: ExtensionExports,
): Promise<void> {
  const asciidocDocument = await vscode.workspace.openTextDocument({
    content: '= AsciiDoc 標題\n\nimage::images/example.png[範例]',
    language: 'asciidoc',
  });
  await vscode.window.showTextDocument(asciidocDocument);
  await waitUntilOutlineAnalysis(
    extensionExports,
    asciidocDocument.uri.toString(),
    ['AsciiDoc 標題'],
  );

  const completionList = await vscode.commands.executeCommand<
    vscode.CompletionList
  >(
    'vscode.executeCompletionItemProvider',
    asciidocDocument.uri,
    new vscode.Position(0, 1),
  );
  assert.ok(
    completionList.items.some(({ label }) => (
      getCompletionLabel(label) === '標題／章節'
    )),
    'AsciiDoc completion provider did not return heading help.',
  );

  const hoverResults = await vscode.commands.executeCommand<readonly vscode.Hover[]>(
    'vscode.executeHoverProvider',
    asciidocDocument.uri,
    new vscode.Position(0, 1),
  );
  assert.ok(
    hoverResults.some((hover) => hover.contents.some((content) => (
      getHoverContentText(content).includes('標題／章節')
    ))),
    'AsciiDoc hover provider did not return heading help.',
  );

  await vscode.commands.executeCommand(OPEN_SYNTAX_GUIDE_COMMAND);
  const syntaxGuideEditor = vscode.window.activeTextEditor;
  assert.ok(syntaxGuideEditor, 'AsciiDoc syntax guide did not open an editor.');
  assert.equal(
    syntaxGuideEditor.document.languageId,
    'asciidoc',
  );
  assert.ok(
    syntaxGuideEditor.document.getText().startsWith(
      '= AsciiDoc 語法說明',
    ),
    'AsciiDoc syntax guide did not open.',
  );

  const markdownDocument = await vscode.workspace.openTextDocument({
    content: '= Markdown heading',
    language: 'markdown',
  });
  await vscode.window.showTextDocument(markdownDocument);
  const markdownCompletions = await vscode.commands.executeCommand<
    vscode.CompletionList
  >(
    'vscode.executeCompletionItemProvider',
    markdownDocument.uri,
    new vscode.Position(0, 1),
  );
  assert.ok(
    !markdownCompletions.items.some(({ label }) => (
      getCompletionLabel(label) === '標題／章節'
    )),
    'AsciiDoc completion leaked into Markdown.',
  );
}

function getCompletionLabel(label: string | vscode.CompletionItemLabel): string {
  return typeof label === 'string' ? label : label.label;
}

function getHoverContentText(
  content: unknown,
): string {
  if (typeof content === 'string') {
    return content;
  }

  if (typeof content !== 'object' || content === null) {
    return '';
  }

  const value = Reflect.get(content, 'value') as unknown;
  return typeof value === 'string' ? value : '';
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

async function waitUntilOutlineAnalysis(
  extensionExports: ExtensionExports,
  documentUri: string,
  expectedTitles: readonly string[],
): Promise<void> {
  const timeoutAt = Date.now() + 5_000;
  while (Date.now() < timeoutAt) {
    const analysis = extensionExports.outline.provider.getAnalysis();
    if (
      analysis?.documentUri === documentUri
      && analysis.headings.map(({ title }) => title).join('\u0000')
        === expectedTitles.join('\u0000')
    ) {
      return;
    }
    await delay(25);
  }

  const analysis = extensionExports.outline.provider.getAnalysis();
  assert.deepEqual(
    analysis?.headings.map(({ title }) => title),
    expectedTitles,
    'The active document Outline was not updated in time.',
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
