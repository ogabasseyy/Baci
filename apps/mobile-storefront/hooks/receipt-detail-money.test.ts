import { describe, expect, it } from '@jest/globals';
import {
  DETAIL_HEADER_MONEY_FIELDS,
  receiptMoneyOverrides,
} from './receipt-detail-money';

describe('receiptMoneyOverrides', () => {
  it('coerces decimal strings to numbers', () => {
    expect(
      receiptMoneyOverrides(
        { total: '150000.50', amount_paid: '100' },
        DETAIL_HEADER_MONEY_FIELDS
      )
    ).toEqual({ total: 150000.5, amount_paid: 100 });
  });

  it('passes numbers through without overrides', () => {
    expect(
      receiptMoneyOverrides({ total: 100 }, DETAIL_HEADER_MONEY_FIELDS)
    ).toEqual({});
  });

  it('skips nullish values without overrides', () => {
    expect(
      receiptMoneyOverrides(
        { total: null, subtotal: undefined },
        DETAIL_HEADER_MONEY_FIELDS
      )
    ).toEqual({});
  });

  it('fails blanks, booleans, and garbage to NaN', () => {
    const overrides = receiptMoneyOverrides(
      { total: '', subtotal: '  ', shipping_fee: true, tax_amount: 'abc' },
      DETAIL_HEADER_MONEY_FIELDS
    );
    expect(overrides.total).toBeNaN();
    expect(overrides.subtotal).toBeNaN();
    expect(overrides.shipping_fee).toBeNaN();
    expect(overrides.tax_amount).toBeNaN();
  });

  it('returns no overrides for non-object rows', () => {
    expect(receiptMoneyOverrides(null, DETAIL_HEADER_MONEY_FIELDS)).toEqual({});
    expect(receiptMoneyOverrides(42, DETAIL_HEADER_MONEY_FIELDS)).toEqual({});
  });

  it('ignores fields outside the list', () => {
    expect(
      receiptMoneyOverrides({ total: '1', other: '2' }, ['total'])
    ).toEqual({ total: 1 });
  });
});
