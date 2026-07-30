const SOURCE_LINE_FRAGMENT_PATTERN = /^L([1-9]\d*)$/u;

/**
 * 解析預覽連結使用的 `#Lx` 行號，並轉為零起算。
 */
export function parseSourceLineFragment(fragment: string): number | null {
  const lineText = SOURCE_LINE_FRAGMENT_PATTERN.exec(fragment)?.[1];
  if (lineText === undefined) {
    return null;
  }

  const oneBasedLine = Number(lineText);
  return Number.isSafeInteger(oneBasedLine)
    ? oneBasedLine - 1
    : null;
}
