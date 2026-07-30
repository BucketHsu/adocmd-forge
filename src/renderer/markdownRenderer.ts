import MarkdownIt from 'markdown-it';

interface RenderedFragment {
  readonly html: string;
  readonly title?: string;
}

const SOURCE_LINE_ATTRIBUTE = 'data-source-line';

const markdown = new MarkdownIt({
  html: false,
  linkify: false,
  typographer: false,
});

type MarkdownOptions = typeof markdown.options;
type MarkdownRenderer = typeof markdown.renderer;
type MarkdownToken = ReturnType<typeof markdown.parse>[number];

wrapCodeBlockRule('code_block');
wrapCodeBlockRule('fence');

/**
 * 將 Markdown 轉為尚未消毒的 HTML fragment。
 */
export function renderMarkdown(source: string): RenderedFragment {
  const environment: Record<string, unknown> = {};
  const tokens = markdown.parse(source, environment);
  const title = findMarkdownTitle(tokens);

  for (const token of tokens) {
    if (
      token.block
      && !token.hidden
      && token.map !== null
      && token.nesting >= 0
      && token.type !== 'code_block'
      && token.type !== 'fence'
      && token.type !== 'inline'
    ) {
      token.attrSet(SOURCE_LINE_ATTRIBUTE, String(token.map[0]));
    }
  }

  const html = markdown.renderer.render(tokens, markdown.options, environment);
  return title === undefined ? { html } : { html, title };
}

function wrapCodeBlockRule(ruleName: 'code_block' | 'fence'): void {
  const originalRule = markdown.renderer.rules[ruleName];
  if (originalRule === undefined) {
    throw new Error(`markdown-it 缺少必要的 ${ruleName} renderer rule。`);
  }

  markdown.renderer.rules[ruleName] = (
    tokens: MarkdownToken[],
    index: number,
    options: MarkdownOptions,
    environment: unknown,
    renderer: MarkdownRenderer,
  ): string => {
    const html = originalRule(tokens, index, options, environment, renderer);
    const sourceMap = tokens[index]?.map;
    return sourceMap === null || sourceMap === undefined
      ? html
      : addSourceLineToFirstElement(html, sourceMap[0]);
  };
}

function addSourceLineToFirstElement(html: string, sourceLine: number): string {
  return html.replace(
    /<([a-z][a-z0-9-]*)(?=[\s>])/iu,
    `<$1 ${SOURCE_LINE_ATTRIBUTE}="${String(sourceLine)}"`,
  );
}

function findMarkdownTitle(tokens: MarkdownToken[]): string | undefined {
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index]?.type !== 'heading_open') {
      continue;
    }

    const inlineToken = tokens[index + 1];
    if (inlineToken?.type !== 'inline' || inlineToken.children === null) {
      continue;
    }

    const title = collectInlineText(inlineToken.children).trim();
    if (title.length > 0) {
      return title;
    }
  }

  return undefined;
}

function collectInlineText(tokens: MarkdownToken[]): string {
  return tokens.map((token) => {
    switch (token.type) {
      case 'code_inline':
      case 'image':
      case 'text':
        return token.content;
      case 'hardbreak':
      case 'softbreak':
        return ' ';
      default:
        return token.children === null ? '' : collectInlineText(token.children);
    }
  }).join('');
}
