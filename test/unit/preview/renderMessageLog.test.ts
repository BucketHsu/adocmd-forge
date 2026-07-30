import { describe, expect, it } from 'vitest';

import { formatRenderMessageForLog } from '../../../src/preview/renderMessageLog';

describe('formatRenderMessageForLog', (): void => {
  it('formats a 0-based source line as a 1-based user-facing line', (): void => {
    expect(formatRenderMessageForLog({
      message: 'include file not found',
      severity: 'error',
      sourceLine: 6,
    })).toBe('ERROR at line 7: include file not found');
  });

  it('keeps log entries on one line and removes control characters', (): void => {
    expect(formatRenderMessageForLog({
      message: 'first\r\nforged\u0007entry',
      severity: 'warning',
    })).toBe('WARNING: first forgedentry');
  });
});
