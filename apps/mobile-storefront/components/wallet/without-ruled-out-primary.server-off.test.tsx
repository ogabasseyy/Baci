import { describe, expect, it } from '@jest/globals';
import type { WalletData } from '@/hooks/wallet-query';
import { withoutRuledOutPrimary } from './without-ruled-out-primary';

const primary = {
  balance: 1200,
  loyalty_points: 0,
  primary_balance_kobo: 500_000,
} as WalletData;

describe('bugfix: stale PiggyVest balance shown after a rollback reload failed', () => {
  it('drops the PiggyVest balance while PiggyVest is ruled out', () => {
    const result = withoutRuledOutPrimary(primary, false);

    expect(result?.primary_balance_kobo).toBeUndefined();
    expect(result?.balance).toBe(1200);
  });

  it('keeps the PiggyVest wallet while PiggyVest is on or unknown', () => {
    expect(withoutRuledOutPrimary(primary, true)).toBe(primary);
    expect(withoutRuledOutPrimary(primary, null)).toBe(primary);
  });
});

describe('server keeps PiggyVest off', () => {
  it('leaves a legacy wallet untouched', () => {
    const legacy = { balance: 900, loyalty_points: 3 } as WalletData;
    expect(withoutRuledOutPrimary(legacy, false)).toBe(legacy);
    expect(withoutRuledOutPrimary(undefined, false)).toBeUndefined();
  });
});

describe('bugfix: stale PiggyVest account re-enables the savings view after a rollback', () => {
  it('drops the PiggyVest funding account too while PiggyVest is ruled out', () => {
    const wallet = {
      balance: 1200,
      funding_account: {
        account_name: 'Ada Obi',
        account_number: '3685660013',
        bank_name: 'Provider Bank',
        provider: 'piggyvest',
      },
      loyalty_points: 0,
      primary_balance_kobo: 500_000,
    } as WalletData;

    const result = withoutRuledOutPrimary(wallet, false);

    expect(result?.funding_account).toBeNull();
    expect(result?.primary_balance_kobo).toBeUndefined();
  });
});
