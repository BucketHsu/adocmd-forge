import type { RenderMessage } from '../models/renderMessage';

const LOG_LINE_BREAK_PATTERN = /[\r\n\u2028\u2029]+/gu;
const LOG_CONTROL_CHARACTER_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu;

/**
 * 將 renderer 訊息整理成單行，避免來源內容偽造 Output Channel 紀錄。
 */
export function formatRenderMessageForLog(
  message: RenderMessage,
): string {
  const severity = message.severity.toUpperCase();
  const location = message.sourceLine === undefined
    ? ''
    : ` at line ${String(message.sourceLine + 1)}`;
  const text = message.message
    .replace(LOG_LINE_BREAK_PATTERN, ' ')
    .replace(LOG_CONTROL_CHARACTER_PATTERN, '')
    .trim();

  return `${severity}${location}: ${text}`;
}
