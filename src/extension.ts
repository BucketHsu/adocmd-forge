import path from 'node:path';

import * as vscode from 'vscode';

import { CommandExecutor } from './commands/commandExecutor';
import { registerPreviewCommands } from './commands/registerPreviewCommands';
import type { RenderResult } from './models/renderResult';
import { PreviewLinkOpener } from './preview/previewLinkOpener';
import { PreviewManager } from './preview/previewManager';
import {
  createNodeRendererWorkerFactory,
  RendererWorkerService,
} from './services/rendererWorkerService';

const OUTPUT_CHANNEL_NAME = 'AdocMD Forge';

export function activate(context: vscode.ExtensionContext): void {
  const outputChannel = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
  const commandExecutor = new CommandExecutor(outputChannel);
  const linkOpener = new PreviewLinkOpener(outputChannel);
  const rendererWorkerService = new RendererWorkerService(
    createNodeRendererWorkerFactory({
      asciidoc: context.asAbsolutePath(
        path.join('dist', 'workers', 'asciidocRenderer.js'),
      ),
      markdown: context.asAbsolutePath(
        path.join('dist', 'workers', 'markdownRenderer.js'),
      ),
    }),
  );
  const previewManager = new PreviewManager({
    extensionUri: context.extensionUri,
    openLink: async (documentUri, href): Promise<void> => {
      await linkOpener.open(documentUri, href);
    },
    outputChannel,
    renderer: (request, signal): Promise<RenderResult> => (
      rendererWorkerService.render(request, signal)
    ),
  });

  context.subscriptions.push(
    outputChannel,
    previewManager,
    rendererWorkerService,
    ...registerPreviewCommands(previewManager, commandExecutor),
  );
  outputChannel.appendLine('AdocMD Forge activated.');
}
