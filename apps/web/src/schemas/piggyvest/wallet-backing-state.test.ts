import { describe, expect, it } from 'vitest';
import { walletBackingStateSchema } from './wallet-backing-state';

describe('walletBackingStateSchema', () => {
  it('accepts the four states public.get_my_wallet_backing_state returns', () => {
    // Arrange & Act & Assert
    for (const state of ['none', 'legacy', 'migrating', 'backed']) {
      expect(walletBackingStateSchema.parse(state)).toBe(state);
    }
  });

  it('rejects anything else, including near-misses and non-strings', () => {
    // Arrange & Act & Assert: an unexpected reply must never read as a state.
    for (const value of [
      'BACKED',
      ' backed',
      'unknown',
      '',
      null,
      undefined,
      1,
      { state: 'backed' },
      ['backed'],
    ]) {
      expect(walletBackingStateSchema.safeParse(value).success).toBe(false);
    }
  });
});
