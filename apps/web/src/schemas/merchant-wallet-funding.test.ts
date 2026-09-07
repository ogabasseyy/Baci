import { describe, expect, it } from 'vitest';
import { merchantWalletFundingConsentSchema } from './merchant-wallet-funding';

describe('merchant wallet funding consent', () => {
  it('accepts literal true only', () =>
    expect(merchantWalletFundingConsentSchema.parse({ consent: true })).toEqual(
      { consent: true }
    ));
  it.each([
    { consent: false },
    {},
    { consent: true, extra: 'x' },
  ])('rejects invalid payload %o', (payload) => {
    expect(merchantWalletFundingConsentSchema.safeParse(payload).success).toBe(
      false
    );
  });
});
