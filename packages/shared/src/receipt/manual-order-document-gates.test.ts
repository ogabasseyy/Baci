import { describe, expect, it } from 'vitest';
import {
  isDecimalMoney,
  isManualOrderRecord,
  isNonNegativeMoney,
  isSettledManualBalance,
  MANUAL_ORDER_ITEM_FINANCIAL_FIELDS,
} from './manual-order-document-gates';

describe('manual-order document gates', () => {
  it('pins the validated item-financial field set', () => {
    expect([...MANUAL_ORDER_ITEM_FINANCIAL_FIELDS].sort()).toEqual([
      'assurance_fee',
      'line_extension_amount',
      'line_id',
      'vat_amount',
      'vat_rate',
    ]);
  });

  it('treats staff-recorded, never-imported rows as manual', () => {
    expect(isManualOrderRecord({ recordedByUserId: 'staff-1' })).toBe(true);
    expect(
      isManualOrderRecord({ recordedByUserId: 'staff-1', importJobId: 'job' })
    ).toBe(false);
    expect(
      isManualOrderRecord({
        recordedByUserId: 'staff-1',
        externalSource: 'bumpa',
      })
    ).toBe(false);
    // A blank staff-entered source is absent, not imported.
    expect(
      isManualOrderRecord({
        recordedByUserId: 'staff-1',
        externalSource: '  ',
      })
    ).toBe(true);
    expect(isManualOrderRecord({})).toBe(false);
    // Corrupt non-string markers fail closed instead of throwing.
    expect(
      isManualOrderRecord({ recordedByUserId: 'staff-1', externalSource: 5 })
    ).toBe(false);
    expect(
      isManualOrderRecord({ recordedByUserId: 'staff-1', importJobId: 0 })
    ).toBe(false);
    expect(
      isManualOrderRecord({
        recordedByUserId: 'staff-1',
        externalSource: null,
        importJobId: undefined,
      })
    ).toBe(true);
  });

  it('settles only finite payments covering a non-negative total', () => {
    expect(isSettledManualBalance({ total: 100, amountPaid: 100 })).toBe(true);
    expect(isSettledManualBalance({ total: 100, amountPaid: 150 })).toBe(true);
    expect(isSettledManualBalance({ total: '100', amountPaid: '100' })).toBe(
      true
    );
    expect(isSettledManualBalance({ total: 100, amountPaid: 50 })).toBe(false);
    // Nulls fail closed, never coerce to zero through Number(null).
    expect(isSettledManualBalance({ total: null, amountPaid: 100 })).toBe(
      false
    );
    expect(isSettledManualBalance({ total: 100, amountPaid: null })).toBe(
      false
    );
    // A negative total is data corruption, never a covered receipt.
    expect(isSettledManualBalance({ total: -100, amountPaid: 0 })).toBe(false);
    expect(isSettledManualBalance({ total: Number.NaN, amountPaid: 100 })).toBe(
      false
    );
    // Booleans and blank strings fail closed: they coerce through Number()
    // (true -> 1, '' -> 0) but the database never produces them for money
    // columns, so only genuine money settles.
    expect(isSettledManualBalance({ total: '', amountPaid: '' })).toBe(false);
    expect(isSettledManualBalance({ total: '  ', amountPaid: 100 })).toBe(
      false
    );
    expect(
      isSettledManualBalance({
        total: true as unknown as number,
        amountPaid: 100,
      })
    ).toBe(false);
    expect(
      isSettledManualBalance({
        total: 100,
        amountPaid: false as unknown as number,
      })
    ).toBe(false);
  });

  it('counts decimal numbers and canonical decimal strings as money', () => {
    expect(isDecimalMoney(100)).toBe(true);
    expect(isDecimalMoney(100.5)).toBe(true);
    expect(isDecimalMoney('100')).toBe(true);
    expect(isDecimalMoney('100.50')).toBe(true);
    expect(isDecimalMoney('-5')).toBe(true);
    expect(isDecimalMoney(0)).toBe(true);
  });

  it('rejects non-decimal coercions money columns never produce', () => {
    expect(isDecimalMoney('0x10')).toBe(false);
    expect(isDecimalMoney('1e3')).toBe(false);
    expect(isDecimalMoney(' 100')).toBe(false);
    expect(isDecimalMoney('100 ')).toBe(false);
    expect(isDecimalMoney('')).toBe(false);
    expect(isDecimalMoney(true)).toBe(false);
    expect(isDecimalMoney(null)).toBe(false);
    expect(isDecimalMoney(undefined)).toBe(false);
    expect(isDecimalMoney(Number.NaN)).toBe(false);
    expect(isDecimalMoney(Number.POSITIVE_INFINITY)).toBe(false);
  });

  it('fails nullish and blank rendered money closed, never zero', () => {
    expect(isNonNegativeMoney(100)).toBe(true);
    expect(isNonNegativeMoney(0)).toBe(true);
    expect(isNonNegativeMoney('100.50')).toBe(true);
    expect(isNonNegativeMoney(null)).toBe(false);
    expect(isNonNegativeMoney(undefined)).toBe(false);
    expect(isNonNegativeMoney('')).toBe(false);
    expect(isNonNegativeMoney('   ')).toBe(false);
    expect(isNonNegativeMoney(-5)).toBe(false);
    expect(isNonNegativeMoney('-5')).toBe(false);
    expect(isNonNegativeMoney('0x10')).toBe(false);
    expect(isNonNegativeMoney('1e3')).toBe(false);
    expect(isNonNegativeMoney(Number.NaN)).toBe(false);
  });

  it('refuses to settle hex, exponent, and padded money strings', () => {
    expect(isSettledManualBalance({ total: '0x10', amountPaid: 100 })).toBe(
      false
    );
    expect(isSettledManualBalance({ total: 100, amountPaid: '1e3' })).toBe(
      false
    );
    expect(isSettledManualBalance({ total: ' 100', amountPaid: 100 })).toBe(
      false
    );
  });
});
