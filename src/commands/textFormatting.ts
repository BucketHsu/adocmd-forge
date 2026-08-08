import * as vscode from 'vscode';

import {
  wrapTextSelections,
  type InlineMarkup,
} from './textFormattingCore';

export { wrapTextSelections } from './textFormattingCore';
export type {
  FormattedText,
  InlineMarkup,
  TextSelectionOffsets,
} from './textFormattingCore';

export async function applyInlineMarkup(
  editor: vscode.TextEditor,
  markup: InlineMarkup,
): Promise<void> {
  const source = editor.document.getText();
  const selectionOffsets = editor.selections.map((selection) => ({
    end: editor.document.offsetAt(selection.end),
    start: editor.document.offsetAt(selection.start),
  }));
  const formatted = wrapTextSelections(source, selectionOffsets, markup);
  if (formatted.text === source) {
    return;
  }

  const didEdit = await editor.edit((editBuilder) => {
    editBuilder.replace(
      new vscode.Range(
        editor.document.positionAt(0),
        editor.document.positionAt(source.length),
      ),
      formatted.text,
    );
  });
  if (!didEdit) {
    return;
  }

  editor.selections = formatted.selections.map((selection) => (
    new vscode.Selection(
      editor.document.positionAt(selection.start),
      editor.document.positionAt(selection.end),
    )
  ));
}
