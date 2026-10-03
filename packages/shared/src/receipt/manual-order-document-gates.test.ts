import { describe, expect, it } from 'vitest';
import {
  MANUAL_ORDER_ITEM_FINANCIAL_FIELDS,
  isManualOrderRecord,
  isSettledManualBalance,
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
    expect(
      isManualOrderRecord({ recordedByUserId: 'staff-1' })
    ).toBe(true);
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
    expect(
      isSettledManualBalance({ total: Number.NaN, amountPaid: 100 })
    ).toBe(false);
  });
});
