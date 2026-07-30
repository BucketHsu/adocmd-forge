import type {
  IncludeSelection,
  IncludeSelectionIssue,
} from './includeTypes';

const TAG_DIRECTIVE_PATTERN = /\b(?:tag|(e)nd)::(\S+?)\[\](?=$|[ \r])/u;

interface TagFrame {
  readonly line: number;
  readonly select: boolean;
  readonly tag: string;
}

interface TagSelectionConfiguration {
  readonly baseSelect: boolean;
  readonly requestedTags: Map<string, boolean>;
  readonly wildcard?: boolean;
}

/**
 * 套用 Asciidoctor 3.0.4 include 的 `lines`、`tag` 與 `tags` 選取規則。
 *
 * `lines` 優先於標籤，與 Asciidoctor 內建處理器一致。
 */
export function selectIncludeContent(
  content: string,
  attributes: Readonly<Record<string, unknown>>,
): IncludeSelection {
  if (hasOwn(attributes, 'lines')) {
    return selectLines(content, toAttributeValue(attributes.lines));
  }

  const tagDefinitions = parseTagDefinitions(attributes);
  return tagDefinitions === undefined
    ? createUnfilteredSelection(content)
    : selectTags(content, tagDefinitions);
}

function selectLines(
  content: string,
  specification: string,
): IncludeSelection {
  const requestedLines = parseRequestedLines(specification);
  if (requestedLines.kind === 'none') {
    return createUnfilteredSelection(content);
  }

  const sourceLines = splitSourceLines(content);
  const selectedLines: string[] = [];
  let firstLine: number | undefined;

  if (!requestedLines.blockedByNonPositiveLine) {
    for (let index = 0; index < sourceLines.length; index += 1) {
      const lineNumber = index + 1;
      if (
        requestedLines.openRangeStart !== undefined
        && lineNumber >= requestedLines.openRangeStart
      ) {
        firstLine ??= lineNumber;
        selectedLines.push(sourceLines[index] ?? '');
        continue;
      }
      if (requestedLines.finiteRanges.some(
        ({ from, to }) => lineNumber >= from && lineNumber <= to,
      )) {
        firstLine ??= lineNumber;
        selectedLines.push(sourceLines[index] ?? '');
      }
    }
  }

  return {
    data: selectedLines,
    filtered: true,
    firstLine: firstLine ?? 1,
    issues: [],
  };
}

interface NoRequestedLines {
  readonly kind: 'none';
}

interface ParsedRequestedLines {
  readonly blockedByNonPositiveLine: boolean;
  readonly finiteRanges: readonly LineRange[];
  readonly kind: 'selection';
  readonly openRangeStart?: number;
}

interface LineRange {
  readonly from: number;
  readonly to: number;
}

type RequestedLines = NoRequestedLines | ParsedRequestedLines;

function parseRequestedLines(specification: string): RequestedLines {
  const definitions = splitDelimitedValue(specification);
  const finiteRanges: LineRange[] = [];
  let blockedByNonPositiveLine = false;
  let hasSelection = false;
  let openRangeStart: number | undefined;

  for (const definition of definitions) {
    const rangeIndex = definition.indexOf('..');
    if (rangeIndex < 0) {
      const lineNumber = rubyInteger(definition);
      finiteRanges.push({
        from: lineNumber,
        to: lineNumber,
      });
      blockedByNonPositiveLine ||= lineNumber <= 0;
      hasSelection = true;
      continue;
    }

    const from = rubyInteger(definition.slice(0, rangeIndex));
    const toText = definition.slice(rangeIndex + 2);
    const to = rubyInteger(toText);
    if (toText.length === 0 || to < 0) {
      openRangeStart = openRangeStart === undefined
        ? from
        : Math.min(openRangeStart, from);
      blockedByNonPositiveLine ||= from <= 0;
      hasSelection = true;
      continue;
    }
    if (from > to) {
      continue;
    }

    hasSelection = true;
    blockedByNonPositiveLine ||= from <= 0;
    finiteRanges.push({
      from,
      to,
    });
  }

  if (!hasSelection) {
    return {
      kind: 'none',
    };
  }

  return {
    blockedByNonPositiveLine,
    finiteRanges,
    kind: 'selection',
    ...(openRangeStart === undefined ? {} : {
      openRangeStart,
    }),
  };
}

function selectTags(
  content: string,
  definitions: Map<string, boolean>,
): IncludeSelection {
  const configuration = createTagSelectionConfiguration(definitions);
  const lines = splitSourceLines(content);
  const selectedLines: string[] = [];
  const selectedTags = new Set<string>();
  const issues: IncludeSelectionIssue[] = [];
  const stack: TagFrame[] = [];
  let firstLine: number | undefined;
  let select = configuration.baseSelect;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const lineNumber = index + 1;
    const directive = TAG_DIRECTIVE_PATTERN.exec(line);

    if (directive !== null) {
      const tag = directive[2];
      if (tag === undefined) {
        continue;
      }

      if (directive[1] !== undefined) {
        const activeFrame = stack.at(-1);
        if (activeFrame?.tag === tag) {
          stack.pop();
          select = stack.at(-1)?.select ?? configuration.baseSelect;
        } else if (configuration.requestedTags.has(tag)) {
          const expectedTag = activeFrame?.tag;
          issues.push({
            code: expectedTag === undefined
              ? 'unexpected-end-tag'
              : 'mismatched-end-tag',
            ...(expectedTag === undefined ? {} : {
              expectedTag,
            }),
            line: lineNumber,
            tag,
          });
        }
        continue;
      }

      if (configuration.requestedTags.has(tag)) {
        select = configuration.requestedTags.get(tag) ?? false;
        if (select) {
          selectedTags.add(tag);
        }
        stack.push({
          line: lineNumber,
          select,
          tag,
        });
      } else if (configuration.wildcard !== undefined) {
        select = stack.length > 0 && !select
          ? false
          : configuration.wildcard;
        stack.push({
          line: lineNumber,
          select,
          tag,
        });
      }
      continue;
    }

    if (select) {
      firstLine ??= lineNumber;
      selectedLines.push(line);
    }
  }

  for (const frame of stack) {
    issues.push({
      code: 'unclosed-tag',
      line: frame.line,
      tag: frame.tag,
    });
  }
  for (const [tag, requested] of configuration.requestedTags) {
    if (requested && !selectedTags.has(tag)) {
      issues.push({
        code: 'missing-tag',
        tag,
      });
    }
  }

  return {
    data: selectedLines,
    filtered: true,
    firstLine: firstLine ?? 1,
    issues,
  };
}

function parseTagDefinitions(
  attributes: Readonly<Record<string, unknown>>,
): Map<string, boolean> | undefined {
  if (hasOwn(attributes, 'tag')) {
    const tag = toAttributeValue(attributes.tag);
    if (tag.length === 0 || tag === '!') {
      return undefined;
    }

    return new Map([
      tag.startsWith('!')
        ? [
            tag.slice(1),
            false,
          ]
        : [
            tag,
            true,
          ],
    ]);
  }
  if (!hasOwn(attributes, 'tags')) {
    return undefined;
  }

  const definitions = new Map<string, boolean>();
  for (const definition of splitDelimitedValue(toAttributeValue(attributes.tags))) {
    if (definition.length === 0 || definition === '!') {
      continue;
    }
    if (definition.startsWith('!')) {
      definitions.set(definition.slice(1), false);
    } else {
      definitions.set(definition, true);
    }
  }

  return definitions.size === 0
    ? undefined
    : definitions;
}

function createTagSelectionConfiguration(
  definitions: Map<string, boolean>,
): TagSelectionConfiguration {
  const requestedTags = new Map(definitions);
  let baseSelect: boolean;
  let wildcard: boolean | undefined;

  if (requestedTags.has('**')) {
    baseSelect = requestedTags.get('**') ?? false;
    requestedTags.delete('**');
    if (requestedTags.has('*')) {
      wildcard = requestedTags.get('*') ?? false;
      requestedTags.delete('*');
    } else if (
      !baseSelect
      && requestedTags.values().next().value === false
    ) {
      wildcard = true;
    }
  } else if (requestedTags.has('*')) {
    const firstTag = requestedTags.keys().next().value;
    wildcard = requestedTags.get('*') ?? false;
    requestedTags.delete('*');
    baseSelect = firstTag === '*'
      ? !wildcard
      : false;
  } else {
    baseSelect = ![...requestedTags.values()].includes(true);
  }

  return {
    baseSelect,
    requestedTags,
    ...(wildcard === undefined ? {} : {
      wildcard,
    }),
  };
}

function splitSourceLines(content: string): string[] {
  if (content.length === 0) {
    return [];
  }

  const lines = content.split(/\r\n|[\n\r]/u);
  if (/[\r\n]$/u.test(content)) {
    lines.pop();
  }
  return lines;
}

function splitDelimitedValue(value: string): string[] {
  return value.includes(',')
    ? value.split(',')
    : value.split(';');
}

function rubyInteger(value: string): number {
  const match = /^\s*([+-]?\d+)/u.exec(value);
  return match?.[1] === undefined
    ? 0
    : Number.parseInt(match[1], 10);
}

function toAttributeValue(value: unknown): string {
  return typeof value === 'string'
    ? value
    : String(value ?? '');
}

function hasOwn(
  attributes: Readonly<Record<string, unknown>>,
  name: string,
): boolean {
  return Object.prototype.hasOwnProperty.call(attributes, name);
}

function createUnfilteredSelection(content: string): IncludeSelection {
  return {
    data: content,
    filtered: false,
    firstLine: 1,
    issues: [],
  };
}
