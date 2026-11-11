import { describe, expect, it } from 'vitest';
import { creditDirectWalletFundingSchema } from './credit-direct-wallet-event';

const funding = { grossAmount: 3, walletAmount: 1, financedAmount: 2 };

describe('creditDirectWalletFundingSchema', () => {
  it.each([
    'grossAmount',
    'walletAmount',
    'financedAmount',
  ] as const)('requires %s to be finite and positive', (field) => {
    for (const amount of [
      0,
      -1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ]) {
      const result = creditDirectWalletFundingSchema.safeParse({
        ...funding,
        [field]: amount,
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(
          result.error.issues.some((issue) => issue.path[0] === field)
        ).toBe(true);
      }
    }
  });

  it.each([
    [2, true],
    [1.9951, true],
    [2.0049, true],
    [1.9949, false],
    [2.0051, false],
  ])('validates reconciliation tolerance for financed amount %s', (financedAmount, valid) => {
    expect(
      creditDirectWalletFundingSchema.safeParse({ ...funding, financedAmount })
        .success
    ).toBe(valid);
  });
});
