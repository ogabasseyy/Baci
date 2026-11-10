import { describe, expect, it } from 'vitest';
import { walletSpendableBreakdownRowsSchema as schema } from './wallet-spendable-breakdown';

const row = {
  spendable_balance: '10.5',
  settled_to_bank_total: 0,
  pending_reconciliation_total: '4308694.00',
};

describe('walletSpendableBreakdownRowsSchema', () => {
  it('parses numeric strings and numbers, and an empty result', () => {
    expect(schema.parse([row])[0]).toEqual({
      spendable_balance: 10.5,
      settled_to_bank_total: 0,
      pending_reconciliation_total: 4308694,
    });
    expect(schema.parse([])).toEqual([]);
  });
  it('fails closed on null, empty, non-numeric or missing values', () => {
    for (const bad of [null, '', 'abc', undefined, Number.NaN, -1, '-5.00']) {
      expect(
        schema.safeParse([{ ...row, spendable_balance: bad }]).success
      ).toBe(false);
    }
    expect(schema.safeParse([{ spendable_balance: 1 }]).success).toBe(false);
  });
});
