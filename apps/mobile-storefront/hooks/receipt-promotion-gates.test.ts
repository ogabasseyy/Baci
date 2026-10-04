import { describe, expect, it } from '@jest/globals';
import {
  hasValidSettledPayments,
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

  it('promotes rows with valid sender financial fields present', () => {
    expect(
      isPromotedManualReceipt(
        coveredRow({
          items: [
            {
              name: 'Phone',
              quantity: 1,
              price: 500,
              line_extension_amount: 500,
              assurance_fee: 0,
              vat_rate: 7.5,
              vat_amount: 37.5,
              line_id: 1,
            },
          ],
        })
      )
    ).toBe(true);
  });

  it.each([
    ['negative extension', { line_extension_amount: -50 }],
    ['negative assurance fee', { assurance_fee: -10 }],
    ['negative vat rate', { vat_rate: -7.5 }],
    ['negative vat amount', { vat_amount: -1 }],
    ['negative line id', { line_id: -2 }],
    ['non-numeric vat amount', { vat_amount: 'abc' }],
    ['hex vat amount', { vat_amount: '0x10' }],
    ['boolean vat amount', { vat_amount: true }],
    ['blank extension', { line_extension_amount: '' }],
    ['infinite extension', { line_extension_amount: Number.POSITIVE_INFINITY }],
  ])('rejects invalid financial fields: %s', (_label, financial) => {
    expect(
      isPromotedManualReceipt(
        coveredRow({
          items: [{ name: 'Phone', quantity: 1, price: 500, ...financial }],
        })
      )
    ).toBe(false);
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
    ['boolean total', { total: true }],
    ['boolean amount paid', { amountPaid: false }],
    ['blank total', { total: '' }],
    ['whitespace amount paid', { amountPaid: '   ' }],
    ['hex total', { total: '0x10' }],
    ['exponent amount paid', { amountPaid: '1e3' }],
    ['padded total', { total: ' 500' }],
  ])('fails closed for %s rows', (_label, override) => {
    expect(isPromotedManualReceipt(coveredRow(override))).toBe(false);
  });

  it('keeps the order/item verdict when payment history is absent', () => {
    expect(isPromotedManualReceipt(coveredRow())).toBe(true);
    expect(isPromotedManualReceipt(coveredRow({ payments: null }))).toBe(true);
  });

  it.each([
    [
      'negative settled payment',
      [{ transaction_type: 'payment', status: 'completed', amount: -50 }],
    ],
    [
      'negative success payment',
      [{ transaction_type: 'payment', status: 'success', amount: '-1' }],
    ],
    [
      'unparseable settled payment',
      [{ transaction_type: 'payment', status: 'completed', amount: 'abc' }],
    ],
    ['malformed history', 'not-an-array'],
  ])('rejects sender-invalid history: %s', (_label, payments) => {
    expect(isPromotedManualReceipt(coveredRow({ payments }))).toBe(false);
  });

  it('ignores unsettled rows when validating history', () => {
    expect(
      isPromotedManualReceipt(
        coveredRow({
          payments: [
            { transaction_type: 'payment', status: 'pending', amount: -50 },
            { transaction_type: 'refund', status: 'completed', amount: -50 },
            { transaction_type: 'payment', status: 'completed', amount: 500 },
          ],
        })
      )
    ).toBe(true);
  });
});

describe('hasValidSettledPayments', () => {
  const settled = (amount: unknown) => [
    { transaction_type: 'payment', status: 'completed', amount },
  ];

  it('accepts present non-negative settled amounts', () => {
    expect(hasValidSettledPayments(settled(500))).toBe(true);
    expect(hasValidSettledPayments(settled('500'))).toBe(true);
    expect(hasValidSettledPayments(settled(0))).toBe(true);
  });

  it('rejects missing or empty settled amounts like the sender', () => {
    // Null coerces to a valid zero under Number(amount ?? 0), masking
    // corrupt history the sender order schema (null -> NaN) refuses.
    expect(hasValidSettledPayments(settled(null))).toBe(false);
    expect(hasValidSettledPayments(settled(undefined))).toBe(false);
    expect(hasValidSettledPayments(settled(''))).toBe(false);
    expect(hasValidSettledPayments(settled(-50))).toBe(false);
  });
});
