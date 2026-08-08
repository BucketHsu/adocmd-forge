import * as vscode from 'vscode';

import { resolveDocumentKind } from '../preview/previewDocument';
import type { CommandExecutor } from './commandExecutor';
import { applyInlineMarkup, type InlineMarkup } from './textFormatting';

export const FORMAT_BOLD_COMMAND = 'adocmdForge.formatBold';
export const FORMAT_CODE_COMMAND = 'adocmdForge.formatCode';
export const FORMAT_HIGHLIGHT_COMMAND = 'adocmdForge.formatHighlight';
export const FORMAT_ITALIC_COMMAND = 'adocmdForge.formatItalic';
export const FORMAT_STRIKE_COMMAND = 'adocmdForge.formatStrike';
export const FORMAT_SUBSCRIPT_COMMAND = 'adocmdForge.formatSubscript';
export const FORMAT_SUPERSCRIPT_COMMAND = 'adocmdForge.formatSuperscript';

export type FormatKind =
  | 'bold'
  | 'code'
  | 'highlight'
  | 'italic'
  | 'strike'
  | 'subscript'
  | 'superscript';

const MARKUP_BY_KIND: Readonly<Record<FormatKind, Readonly<{
  asciidoc: InlineMarkup;
  markdown: InlineMarkup;
}>>> = {
  bold: {
    asciidoc: { close: '*', open: '*' },
    markdown: { close: '**', open: '**' },
  },
  code: {
    asciidoc: { close: '`', open: '`' },
    markdown: { close: '`', open: '`' },
  },
  highlight: {
    asciidoc: { close: '#', open: '#' },
    markdown: { close: '==', open: '==' },
  },
  italic: {
    asciidoc: { close: '_', open: '_' },
    markdown: { close: '*', open: '*' },
  },
  strike: {
    asciidoc: { close: '#', open: '[.line-through]#' },
    markdown: { close: '~~', open: '~~' },
  },
  subscript: {
    asciidoc: { close: '~', open: '~' },
    markdown: { close: '</sub>', open: '<sub>' },
  },
  superscript: {
    asciidoc: { close: '^', open: '^' },
    markdown: { close: '</sup>', open: '<sup>' },
  },
};

export function registerFormattingCommands(
  commandExecutor: CommandExecutor,
): vscode.Disposable[] {
  const commands: readonly [string, string, FormatKind][] = [
    [FORMAT_BOLD_COMMAND, 'Bold', 'bold'],
    [FORMAT_ITALIC_COMMAND, 'Italic', 'italic'],
    [FORMAT_HIGHLIGHT_COMMAND, 'Highlight', 'highlight'],
    [FORMAT_CODE_COMMAND, 'Inline Code', 'code'],
    [FORMAT_STRIKE_COMMAND, 'Strike Through', 'strike'],
    [FORMAT_SUPERSCRIPT_COMMAND, 'Superscript', 'superscript'],
    [FORMAT_SUBSCRIPT_COMMAND, 'Subscript', 'subscript'],
  ];

  return commands.map(([command, title, kind]) => (
    vscode.commands.registerCommand(command, async (): Promise<void> => {
      await commandExecutor.run(title, async (): Promise<void> => {
        await applyFormat(kind);
      });
    })
  ));
}

export async function applyFormatToEditor(
  editor: vscode.TextEditor,
  kind: FormatKind,
): Promise<void> {
  const documentKind = resolveDocumentKind(
    editor.document.languageId,
    editor.document.fileName,
  );
  if (documentKind === undefined) {
    throw new Error('格式工具列只支援 AsciiDoc 與 Markdown 文件。');
  }

  await applyInlineMarkup(editor, MARKUP_BY_KIND[kind][documentKind]);
}

async function applyFormat(kind: FormatKind): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (editor === undefined) {
    throw new Error('請先開啟要套用格式的文件。');
  }

  await applyFormatToEditor(editor, kind);
}
