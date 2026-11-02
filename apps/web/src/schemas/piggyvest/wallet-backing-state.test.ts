import { describe, expect, it } from 'vitest';
import {
  walletBackingMerchantIdSchema,
  walletBackingStateSchema,
} from './wallet-backing-state';

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

  it('accepts a merchant UUID and rejects anything else before the RPC runs', () => {
    // Arrange & Act & Assert: this schema is built when the module loads, so
    // parsing here also proves the module initialises.
    expect(
      walletBackingMerchantIdSchema.parse(
        '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b'
      )
    ).toBe('6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b');
    for (const value of [
      'not-a-uuid',
      '',
      '6f1c2a3b4d5e4f608a7b9c0d1e2f3a4b',
      null,
      1,
    ]) {
      expect(walletBackingMerchantIdSchema.safeParse(value).success).toBe(
        false
      );
    }
  });
});
