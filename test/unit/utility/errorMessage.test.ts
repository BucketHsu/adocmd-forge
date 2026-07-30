import { describe, expect, it } from 'vitest';

import { getErrorMessage } from '../../../src/utility/errorMessage';

describe('getErrorMessage', (): void => {
  it('uses a standard Error message', (): void => {
    expect(getErrorMessage(new Error('render failed'))).toBe('render failed');
  });

  it.each([
    ['plain failure', 'plain failure'],
    [null, 'null'],
    [42, '42'],
  ])('normalizes %j', (error, expected): void => {
    expect(getErrorMessage(error)).toBe(expected);
  });

  it('survives an object with a throwing string conversion', (): void => {
    const hostileValue = {
      toString(): string {
        throw new Error('conversion failed');
      },
    };

    expect(getErrorMessage(hostileValue)).toBe('Unknown error.');
  });
});
