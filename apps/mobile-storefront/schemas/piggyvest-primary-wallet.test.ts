import { describe, expect, it } from '@jest/globals';
import { PiggyvestPrimaryWalletSchemas as schemas } from './piggyvest-primary-wallet';

describe('primary wallet mobile schemas', () => {
  it('does not accept a Paystack account as a PiggyVest account', () => {
    expect(
      schemas.snapshot.safeParse({
        status: 'ready',
        balanceKobo: 0,
        account: {
          accountNumber: '0123456789',
          accountName: 'Test',
          bankName: 'Bank',
          provider: 'paystack',
        },
      }).success
    ).toBe(false);
  });
  it('requires confirmed account details for a ready wallet', () => {
    expect(
      schemas.snapshot.safeParse({
        status: 'ready',
        balanceKobo: 0,
        account: null,
      }).success
    ).toBe(false);
    expect(
      schemas.snapshot.safeParse({ status: 'pending', account: null }).success
    ).toBe(true);
  });
  it('rejects provider identifiers injected into setup requests', () => {
    expect(
      schemas.create.safeParse({
        merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
        bvn: '00000000000',
        consent: true,
        walletId: 'injected',
      }).success
    ).toBe(false);
  });
});
