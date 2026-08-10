export type AsciiDocReferenceCompletionKind = 'image' | 'include' | 'xref';

export interface AsciiDocReferenceCompletionContext {
  readonly kind: AsciiDocReferenceCompletionKind;
  readonly replacementEnd: number;
  readonly replacementStart: number;
  readonly shorthand: boolean;
  readonly target: string;
}

/** 找出游標前可提供工作區路徑或 Anchor 補全的 AsciiDoc 引用。 */
export function getAsciiDocReferenceCompletionContext(
  lineText: string,
  character: number,
): AsciiDocReferenceCompletionContext | undefined {
  const safeCharacter = Math.max(0, Math.min(character, lineText.length));
  const beforeCursor = lineText.slice(0, safeCharacter);
  const macroMatch = /\b(include::|image::?|xref:)([^\s\[]*)$/u.exec(beforeCursor);
  if (macroMatch !== null) {
    const macro = macroMatch[1];
    const target = macroMatch[2] ?? '';
    const kind = macro?.startsWith('include') === true
      ? 'include'
      : macro?.startsWith('image') === true
        ? 'image'
        : 'xref';
    return {
      kind,
      target,
      shorthand: false,
      replacementStart: safeCharacter - target.length,
      replacementEnd: safeCharacter,
    };
  }

  const shorthandMatch = /<<([^,>\s]*)$/u.exec(beforeCursor);
  if (shorthandMatch === null) {
    return undefined;
  }
  const target = shorthandMatch[1] ?? '';
  return {
    kind: 'xref',
    target,
    shorthand: true,
    replacementStart: safeCharacter - target.length,
    replacementEnd: safeCharacter,
  };
}
