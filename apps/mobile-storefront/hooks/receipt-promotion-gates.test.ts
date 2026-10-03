import { describe, expect, it } from '@jest/globals';
import {
  isPromotedManualReceipt,
  type ManualReceiptPromotionInput,
} from './receipt-promotion-gates';

function coveredRow(
  overrides: Partial<ManualReceiptPromotionInput> = {}
): ManualReceiptPromotionInput {
  return {
    recordedByUserId: 'staff-1',
    importJobId: null,
    externalSource: null,
    paymentStatus: 'pending',
    shippingStatus: 'processing',
    total: 500,
    subtotal: 500,
    shippingFee: 0,
    taxAmount: 0,
    discountAmount: 0,
    amountPaid: 500,
    currency: 'NGN',
    items: [{ name: 'Phone', quantity: 1, price: 500 }],
    ...overrides,
  };
}

describe('isPromotedManualReceipt', () => {
  it('promotes covered manual balances under non-paid labels', () => {
    expect(isPromotedManualReceipt(coveredRow())).toBe(true);
    expect(
      isPromotedManualReceipt(coveredRow({ paymentStatus: 'partially_paid' }))
    ).toBe(true);
  });

  it('accepts mapped detail items and raw order rows alike', () => {
    expect(
      isPromotedManualReceipt(
        coveredRow({
          items: [{ product_name: 'Phone', quantity: 1, price: 500 }],
        })
      )
    ).toBe(true);
  });

  it.each([
    ['imported', { importJobId: 'job-1' }],
    ['non-manual', { recordedByUserId: null }],
    ['cancelled', { shippingStatus: 'cancelled' }],
    ['unknown status', { paymentStatus: 'on_hold' }],
    ['uncovered', { amountPaid: 100 }],
    ['negative total', { total: -500, amountPaid: 0 }],
    ['null total', { total: null }],
    ['empty items', { items: [] }],
    ['null item entry', { items: [null] }],
    ['nameless item', { items: [{ quantity: 1, price: 500 }] }],
    ['bad currency', { currency: 'NAIRA' }],
    ['numeric payment status', { paymentStatus: 7 }],
    ['numeric shipping status', { shippingStatus: 3 }],
    ['numeric provenance', { externalSource: 7 }],
  ])('fails closed for %s rows', (_label, override) => {
    expect(isPromotedManualReceipt(coveredRow(override))).toBe(false);
  });
});
