import { describe, expect, it } from 'vitest';
import { PAYSTACK_DVA_WINDOW_MS } from './paystack-dva-window';

describe('PAYSTACK_DVA_WINDOW_MS', () => {
  it('keeps the default provisioning window at 90 minutes', () => {
    expect(PAYSTACK_DVA_WINDOW_MS).toBe(90 * 60 * 1000);
  });
});
