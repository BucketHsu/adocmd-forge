import {
  ASCII_DOC_SYNTAX_ENTRIES,
  type AsciiDocCompletionContext,
  type AsciiDocSyntaxEntry,
} from './asciidocSyntax';

export interface AsciiDocCompletionRequest {
  readonly languageId: string;
  readonly lineText: string;
  readonly character: number;
}

export interface AsciiDocCompletionSuggestion {
  readonly entry: AsciiDocSyntaxEntry;
  readonly replacementStart: number;
  readonly replacementEnd: number;
}

interface CompletionContextMatch {
  readonly context: AsciiDocCompletionContext;
  readonly replacementStart: number;
}

/**
 * Returns focused suggestions only when the text immediately before the
 * cursor is a known AsciiDoc construct.  Plain prose intentionally returns
 * no suggestions so that Ctrl+Space does not become noisy in normal writing.
 */
export function getAsciiDocCompletionSuggestions(
  request: AsciiDocCompletionRequest,
): readonly AsciiDocCompletionSuggestion[] {
  if (request.languageId !== 'asciidoc') {
    return [];
  }

  const character = clampCharacter(request.lineText, request.character);
  const beforeCursor = request.lineText.slice(0, character);
  const contextMatch = matchCompletionContext(beforeCursor);

  if (contextMatch === undefined) {
    return [];
  }

  const entries = ASCII_DOC_SYNTAX_ENTRIES.filter(({ contexts }) => (
    contexts.includes(contextMatch.context)
  ));

  return entries.map((entry): AsciiDocCompletionSuggestion => ({
    entry,
    replacementStart: contextMatch.replacementStart,
    replacementEnd: character,
  }));
}

function matchCompletionContext(
  beforeCursor: string,
): CompletionContextMatch | undefined {
  const leadingWhitespaceLength = beforeCursor.length
    - beforeCursor.trimStart().length;
  const trimmed = beforeCursor.slice(leadingWhitespaceLength);

  if (trimmed.length === 0) {
    return {
      context: 'blank',
      replacementStart: leadingWhitespaceLength,
    };
  }

  if (/^=+\s*$/.test(trimmed)) {
    return {
      context: 'heading',
      replacementStart: leadingWhitespaceLength,
    };
  }

  if (/^(?:\*+|-+|\.+)\s*$/.test(trimmed)) {
    return {
      context: 'list',
      replacementStart: leadingWhitespaceLength,
    };
  }

  if (/^\[[A-Za-z0-9_,=+.-]*$/.test(trimmed)) {
    return {
      context: 'block',
      replacementStart: leadingWhitespaceLength,
    };
  }

  if (/^(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION):?$/i.test(trimmed)) {
    return {
      context: 'block',
      replacementStart: leadingWhitespaceLength,
    };
  }

  if (/^:toc[A-Za-z]*:?$/.test(trimmed)) {
    return {
      context: 'toc',
      replacementStart: leadingWhitespaceLength,
    };
  }

  if (/^:[A-Za-z0-9_-]*$/.test(trimmed)) {
    return {
      context: 'attribute',
      replacementStart: leadingWhitespaceLength,
    };
  }

  const tokenMatch = /(?:^|\s)(\S+)$/u.exec(beforeCursor);
  if (tokenMatch === null) {
    return undefined;
  }

  const token = tokenMatch[1];
  if (token === undefined) {
    return undefined;
  }

  const tokenStart = beforeCursor.length - token.length;

  if (/^image::[A-Za-z0-9_./-]*$/.test(token)) {
    return {
      context: 'image',
      replacementStart: tokenStart,
    };
  }

  if (/^include::[A-Za-z0-9_./-]*$/.test(token)) {
    return {
      context: 'include',
      replacementStart: tokenStart,
    };
  }

  if (/^link:[A-Za-z0-9_./:#?&=%-]*$/.test(token)) {
    return {
      context: 'link',
      replacementStart: tokenStart,
    };
  }

  if (/^xref:[A-Za-z0-9_./:#?&=%-]*$/.test(token)) {
    return {
      context: 'xref',
      replacementStart: tokenStart,
    };
  }

  if (/^(?:\[\[|\[#)[A-Za-z0-9_-]*$/.test(token)) {
    return {
      context: 'anchor',
      replacementStart: tokenStart,
    };
  }

  if (/^(?:\*|_|`)$/u.test(token)) {
    return {
      context: 'inline',
      replacementStart: tokenStart,
    };
  }

  return undefined;
}

function clampCharacter(lineText: string, character: number): number {
  if (character <= 0) {
    return 0;
  }

  return Math.min(character, lineText.length);
}
