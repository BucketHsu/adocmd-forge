import { describe, expect, it } from 'vitest';

import { createNonce } from '../../../src/utility/nonce';

describe('createNonce', (): void => {
  it('creates URL-safe random values with sufficient entropy', (): void => {
    const first = createNonce();
    const second = createNonce();

    expect(first).toMatch(/^[\w-]{22}$/u);
    expect(second).toMatch(/^[\w-]{22}$/u);
    expect(second).not.toBe(first);
  });
});
