import { describe, expect, it } from 'vitest';

import { WebviewDeliveryState } from '../../../src/preview/webviewDeliveryState';

describe('WebviewDeliveryState', (): void => {
  it('treats every ready message as a new runtime generation', (): void => {
    const state = new WebviewDeliveryState();

    expect(state.markReady()).toBe(1);
    expect(state.markReady()).toBe(2);
    expect(state.isReady).toBe(true);
  });

  it('marks only the current generation unavailable after failed delivery', (): void => {
    const state = new WebviewDeliveryState();
    const previousGeneration = state.markReady();
    const currentGeneration = state.markReady();

    state.markDeliveryFailed(previousGeneration);
    expect(state.isReady).toBe(true);

    state.markDeliveryFailed(currentGeneration);
    expect(state.isReady).toBe(false);
  });

  it('becomes unavailable while a new HTML shell is loading', (): void => {
    const state = new WebviewDeliveryState();
    state.markReady();

    expect(state.markReloading()).toBe(2);
    expect(state.isReady).toBe(false);
    expect(state.markReady()).toBe(3);
    expect(state.isReady).toBe(true);
  });

  it('cannot become ready again after disposal', (): void => {
    const state = new WebviewDeliveryState();
    state.markReady();

    state.dispose();

    expect(state.isReady).toBe(false);
    expect(state.markReady()).toBe(2);
    expect(state.isReady).toBe(false);
  });
});
