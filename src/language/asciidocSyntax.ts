export type AsciiDocSyntaxId =
  | 'heading'
  | 'paragraph'
  | 'unorderedList'
  | 'orderedList'
  | 'checklist'
  | 'sourceBlock'
  | 'admonition'
  | 'table'
  | 'link'
  | 'xref'
  | 'anchor'
  | 'image'
  | 'include'
  | 'attribute'
  | 'toc'
  | 'bold'
  | 'italic'
  | 'monospace';

export type AsciiDocCompletionContext =
  | 'blank'
  | 'heading'
  | 'list'
  | 'block'
  | 'link'
  | 'xref'
  | 'anchor'
  | 'image'
  | 'include'
  | 'attribute'
  | 'toc'
  | 'inline';

export interface AsciiDocSyntaxEntry {
  readonly id: AsciiDocSyntaxId;
  readonly label: string;
  readonly detail: string;
  readonly documentation: string;
  readonly insertText: string;
  readonly contexts: readonly AsciiDocCompletionContext[];
}

function entry(
  id: AsciiDocSyntaxId,
  label: string,
  detail: string,
  documentation: string,
  insertText: string,
  contexts: readonly AsciiDocCompletionContext[],
): AsciiDocSyntaxEntry {
  return {
    id,
    label,
    detail,
    documentation,
    insertText,
    contexts,
  };
}

/**
 * The catalogue is deliberately static.  It is shared by completion,
 * hover and the syntax guide so that user-facing descriptions do not drift.
 */
export const ASCII_DOC_SYNTAX_ENTRIES: readonly AsciiDocSyntaxEntry[] = [
  entry(
    'heading',
    '標題／章節',
    'AsciiDoc 標題與章節',
    '使用一至六個 `=` 表示文件標題與章節層級。',
    '= ${1:文件標題}',
    ['blank', 'heading'],
  ),
  entry(
    'paragraph',
    '段落',
    '一般段落文字',
    'AsciiDoc 以空白行分隔段落，直接輸入文字即可。',
    '${1:段落內容}',
    ['blank'],
  ),
  entry(
    'unorderedList',
    '無序清單',
    '以星號建立無序清單',
    '使用 `*`、`**` 等層級建立無序清單。',
    '* ${1:清單項目}',
    ['blank', 'list'],
  ),
  entry(
    'orderedList',
    '有序清單',
    '以句點建立有序清單',
    '使用 `.`、`..` 等層級建立有序清單。',
    '. ${1:清單項目}',
    ['blank', 'list'],
  ),
  entry(
    'checklist',
    'Checklist',
    '可勾選的待辦清單',
    '使用 `* [ ]` 建立未完成項目，使用 `* [x]` 表示已完成。',
    '* [ ] ${1:待辦事項}',
    ['blank', 'list'],
  ),
  entry(
    'sourceBlock',
    'Source Block',
    '程式碼區塊',
    '使用 `[source,語言]` 與 `----` 包住程式碼。',
    '[source,${1:typescript}]\n----\n${2:程式碼}\n----',
    ['blank', 'block'],
  ),
  entry(
    'admonition',
    'Admonition',
    '提示、注意與警告區塊',
    '支援 `NOTE`、`TIP`、`IMPORTANT`、`WARNING` 與 `CAUTION`。',
    '${1|NOTE,TIP,IMPORTANT,WARNING,CAUTION|}: ${2:說明}',
    ['blank', 'block'],
  ),
  entry(
    'table',
    '表格',
    'AsciiDoc 表格',
    '使用 `|===` 包住表格內容，欄位以 `|` 分隔。',
    '[cols="${1:1,1}", options="header"]\n|===\n|${2:欄位一} |${3:欄位二}\n\n|${4:值一} |${5:值二}\n|===',
    ['blank', 'block'],
  ),
  entry(
    'link',
    'Link',
    '外部或相對連結',
    '使用 `link:URL[顯示文字]` 建立連結。',
    'link:${1:https://example.com}[${2:連結文字}]',
    ['blank', 'link'],
  ),
  entry(
    'xref',
    'Cross Reference',
    '文件內部交叉引用',
    '使用 `xref:文件.adoc#anchor[文字]` 或 `<<anchor,文字>>` 連結文件位置。',
    'xref:${1:章節-id}[${2:連結文字}]',
    ['blank', 'xref'],
  ),
  entry(
    'anchor',
    'Anchor',
    '建立文件錨點',
    '使用 `[[id]]` 或 `[#id]` 建立可被引用的錨點。',
    '[[${1:anchor-id}]]',
    ['blank', 'anchor'],
  ),
  entry(
    'image',
    'Image',
    '插入圖片',
    '使用 `image::路徑[替代文字]` 插入區塊圖片。',
    'image::${1:images/example.png}[${2:替代文字}]',
    ['blank', 'image'],
  ),
  entry(
    'include',
    'Include',
    '嵌入其他 AsciiDoc 檔案',
    '使用 `include::路徑[]` 嵌入其他文件或程式碼檔案。',
    'include::${1:chapter.adoc}[${2:leveloffset=+1}]',
    ['blank', 'include'],
  ),
  entry(
    'attribute',
    'Attribute',
    '設定文件屬性',
    '使用 `:名稱: 值` 設定文件屬性，之後以 `{名稱}` 取用。',
    ':${1:attribute}: ${2:value}',
    ['blank', 'attribute'],
  ),
  entry(
    'toc',
    'TOC',
    '產生目錄',
    '使用 `:toc:` 或 `:toc: left` 控制文件目錄。',
    ':toc:',
    ['blank', 'toc', 'attribute'],
  ),
  entry(
    'bold',
    '粗體',
    '粗體文字',
    '使用一對 `*` 包住文字，例如 `*重要內容*`。',
    '*${1:粗體文字}*',
    ['inline'],
  ),
  entry(
    'italic',
    '斜體',
    '斜體文字',
    '使用一對 `_` 包住文字，例如 `_補充說明_`。',
    '_${1:斜體文字}_',
    ['inline'],
  ),
  entry(
    'monospace',
    '等寬文字',
    '等寬或程式碼文字',
    '使用一對反引號包住文字，例如 `` `npm run build` ``。',
    '`${1:等寬文字}`',
    ['inline'],
  ),
];

export function getAsciiDocSyntaxEntry(
  id: AsciiDocSyntaxId,
): AsciiDocSyntaxEntry | undefined {
  return ASCII_DOC_SYNTAX_ENTRIES.find((syntaxEntry) => syntaxEntry.id === id);
}
