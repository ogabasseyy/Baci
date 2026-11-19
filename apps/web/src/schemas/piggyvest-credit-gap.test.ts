import { describe, expect, it } from 'vitest';
import { piggyvestCreditGapSchemas as schemas } from './piggyvest-credit-gap';

const wallet = {
  walletId: 'plan-wallet-a',
  inflow: [{ reference: 'PVB01A', at: '2026-11-10T12:00:00+00:00' }],
  inflowTruncated: false,
  interest: [],
  interestTruncated: false,
  unkeyed: 0,
};
const snapshot = {
  generatedAt: '2026-11-11T23:00:00.000+00:00',
  windowStart: '2026-11-08T23:00:00.000+00:00',
  businessId: 'synthetic-business',
  wallets: [wallet],
  walletsTotal: 3,
  walletsDeferred: 2,
};

describe('credit-gap ledger snapshot schema', () => {
  it('accepts the function result', () => {
    expect(schemas.ledgerSnapshot.safeParse(snapshot).success).toBe(true);
    expect(schemas.ledgerRows.safeParse([{ result: snapshot }]).success).toBe(
      true
    );
  });

  it.each([
    ['an unexpected key', { ...snapshot, extra: true }],
    ['a deferred count that disagrees', { ...snapshot, walletsDeferred: 0 }],
    [
      'a window that starts after it was generated',
      { ...snapshot, windowStart: '2026-11-12T00:00:00+00:00' },
    ],
    [
      'a wallet row with a missing key',
      { ...snapshot, wallets: [{ ...wallet, unkeyed: undefined }] },
    ],
    [
      'an empty PVB credit id',
      {
        ...snapshot,
        wallets: [
          { ...wallet, inflow: [{ reference: '', at: wallet.inflow[0].at }] },
        ],
      },
    ],
  ])('rejects %s', (_label, value) => {
    expect(schemas.ledgerSnapshot.safeParse(value).success).toBe(false);
  });

  it('requires exactly one row', () => {
    expect(schemas.ledgerRows.safeParse([]).success).toBe(false);
  });
});
