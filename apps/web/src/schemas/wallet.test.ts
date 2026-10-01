import { describe, expect, it } from 'vitest';
import { walletSettingsSchema } from './wallet';

describe('walletSettingsSchema', () => {
  it('accepts the supported wallet payout settings', () => {
    expect(
      walletSettingsSchema.safeParse({
        autoPayoutDay: 'monday',
        autoPayoutEnabled: true,
        minPayoutAmount: 1000,
      }).success
    ).toBe(true);
  });

  it.each([
    999,
    10_000_001,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])('rejects unsafe payout threshold %s', (minPayoutAmount) => {
    expect(walletSettingsSchema.safeParse({ minPayoutAmount }).success).toBe(
      false
    );
  });
});
