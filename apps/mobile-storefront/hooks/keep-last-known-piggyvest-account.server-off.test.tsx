import { describe, expect, it } from '@jest/globals';
import { keepLastKnownPiggyvestAccount } from './keep-last-known-piggyvest-account';
import type { WalletQueryData } from './wallet-query';

const piggyvestAccount = {
  account_name: 'OGB / ADA',
  account_number: '9814644749',
  bank_name: 'Provider Bank',
  provider: 'piggyvest',
};
const paystackAccount = { ...piggyvestAccount, provider: 'paystack' };

function load(wallet: Record<string, unknown>): WalletQueryData {
  return {
    transactions: [],
    wallet: { balance: 0, loyalty_points: 0, ...wallet },
  } as WalletQueryData;
}

describe('keepLastKnownPiggyvestAccount with the server keeping PiggyVest off', () => {
  it('leaves a legacy wallet exactly as loaded', () => {
    const next = load({ funding_account: null });
    expect(
      keepLastKnownPiggyvestAccount(
        next,
        load({ funding_account: paystackAccount })
      )
    ).toBe(next);
  });
});

describe('bugfix: unreachable server made a known PiggyVest customer look new (walk 11)', () => {
  it('keeps the last-known PiggyVest account through a failed read', () => {
    const next = load({ funding_account: null, primary_unavailable: true });

    const kept = keepLastKnownPiggyvestAccount(
      next,
      load({
        funding_account: piggyvestAccount,
        primary_balance_kobo: 35_620_000,
      })
    );

    expect(kept.wallet.funding_account).toEqual(piggyvestAccount);
    expect(kept.wallet.requires_funding_account_consent).toBe(false);
    // The balance stays unknown: no old figure is carried over.
    expect(kept.wallet.primary_balance_kobo).toBeUndefined();
    expect(kept.wallet.primary_unavailable).toBe(true);
  });

  it('carries nothing when there was no earlier PiggyVest account', () => {
    const next = load({ funding_account: null, primary_unavailable: true });
    expect(keepLastKnownPiggyvestAccount(next, undefined)).toBe(next);
  });

  it('never overrides a fresh answer', () => {
    const next = load({ funding_account: paystackAccount });
    expect(
      keepLastKnownPiggyvestAccount(
        next,
        load({ funding_account: piggyvestAccount })
      )
    ).toBe(next);
  });
});
