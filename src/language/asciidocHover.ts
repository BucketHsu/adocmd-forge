import {
  getAsciiDocSyntaxEntry,
  type AsciiDocSyntaxId,
} from './asciidocSyntax';

export interface AsciiDocHoverRequest {
  readonly languageId: string;
  readonly lineText: string;
  readonly character: number;
}

export interface AsciiDocHoverInfo {
  readonly id: AsciiDocSyntaxId;
  readonly markdown: string;
  readonly start: number;
  readonly end: number;
}

interface HoverMatcher {
  readonly id: AsciiDocSyntaxId;
  readonly pattern: RegExp;
  readonly group?: number;
}

const HOVER_MATCHERS: readonly HoverMatcher[] = [
  {
    id: 'heading',
    pattern: /^(\s*)(=+)(?=\s|$)/u,
    group: 2,
  },
  {
    id: 'checklist',
    pattern: /^(\s*\*+\s+\[[ xX]\])/u,
  },
  {
    id: 'unorderedList',
    pattern: /^(\s*)(\*+)(?=\s)/u,
    group: 2,
  },
  {
    id: 'orderedList',
    pattern: /^(\s*)(\.+)(?=\s)/u,
    group: 2,
  },
  {
    id: 'sourceBlock',
    pattern: /^(\s*\[source(?:,[^\]]*)?\])/iu,
  },
  {
    id: 'admonition',
    pattern: /^(\s*)(NOTE|TIP|IMPORTANT|WARNING|CAUTION):/iu,
    group: 2,
  },
  {
    id: 'table',
    pattern: /^(\s*\|===)/u,
  },
  {
    id: 'toc',
    pattern: /^(\s*:toc(?::|\s|$)[^\n]*)/u,
  },
  {
    id: 'attribute',
    pattern: /^(\s*:[A-Za-z0-9_-]+:\s*[^\n]*)/u,
  },
  {
    id: 'image',
    pattern: /\bimage::[^\s\[]+(?:\[[^\]]*\])?/u,
  },
  {
    id: 'include',
    pattern: /\binclude::[^\s\[]+(?:\[[^\]]*\])?/u,
  },
  {
    id: 'link',
    pattern: /\blink:[^\s\[]+(?:\[[^\]]*\])?/u,
  },
  {
    id: 'xref',
    pattern: /\bxref:[^\s\[]+(?:\[[^\]]*\])?/u,
  },
  {
    id: 'anchor',
    pattern: /(?:\[\[[^\]]*\]\]|\[#[-A-Za-z0-9_:.]+\]|<<[^>]+>>)/u,
  },
  {
    id: 'bold',
    pattern: /(?<!\w)\*[^*\n]+\*/u,
  },
  {
    id: 'italic',
    pattern: /(?<!\w)_[^_\n]+_/u,
  },
  {
    id: 'monospace',
    pattern: /`[^`\n]+`/u,
  },
];

export function getAsciiDocHoverInfo(
  request: AsciiDocHoverRequest,
): AsciiDocHoverInfo | undefined {
  if (request.languageId !== 'asciidoc') {
    return undefined;
  }

  const character = Math.max(
    0,
    Math.min(request.character, request.lineText.length),
  );

  for (const matcher of HOVER_MATCHERS) {
    const match = matcher.pattern.exec(request.lineText);
    if (match === null) {
      continue;
    }

    const groupText = matcher.group === undefined
      ? match[0]
      : match[matcher.group];
    if (groupText === undefined) {
      continue;
    }

    const matchStart = matcher.group === undefined
      ? match.index
      : match.index + match[0].indexOf(groupText);
    const matchEnd = matchStart + groupText.length;

    if (character < matchStart || character > matchEnd) {
      continue;
    }

    const entry = getAsciiDocSyntaxEntry(matcher.id);
    if (entry === undefined) {
      continue;
    }

    return {
      id: matcher.id,
      markdown: createHoverMarkdown(entry.documentation, entry.label, entry.insertText),
      start: matchStart,
      end: matchEnd,
    };
  }

  return undefined;
}

function createHoverMarkdown(
  documentation: string,
  label: string,
  insertText: string,
): string {
  return [
    `### ${label}`,
    '',
    documentation,
    '',
    '範例：',
    '',
    '```asciidoc',
    snippetToExample(insertText),
    '```',
  ].join('\n');
}

function snippetToExample(snippet: string): string {
  return snippet
    .replace(/\$\{\d+\|([^,}|]+)(?:,[^}|]+)*\|\}/gu, '$1')
    .replace(/\$\{\d+:([^}]+)\}/gu, '$1')
    .replace(/\$\{\d+\}/gu, '內容');
}
