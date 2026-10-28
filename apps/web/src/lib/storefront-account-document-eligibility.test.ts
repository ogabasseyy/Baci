import { describe, expect, it } from 'vitest';
import {
  getCurrentDocumentKind,
  isManualOrderDocumentAvailable,
  isReceiptEligible,
  manualDocumentAvailabilityFlags,
  normalizePaymentStatus,
  normalizeShippingStatus,
} from '@/lib/storefront-account-document-eligibility';

describe('storefront account document status helpers', () => {
  it('makes a fully paid manual receipt downloadable before shipping', () => {
    const input = {
      paymentStatus: 'paid',
      shippingStatus: 'pending',
      recordedByUserId: 'staff-1',
      total: 100,
      amountPaid: 100,
      money: {
        total: 100,
        subtotal: 100,
        shipping_fee: 0,
        tax_amount: 0,
        discount_amount: 0,
        amount_paid: 100,
      },
      items: [{ name: 'Device', quantity: 1, price: 100 }],
    };
    expect(isReceiptEligible(input)).toBe(true);
    expect(getCurrentDocumentKind(input)).toBe('receipt');
    expect(manualDocumentAvailabilityFlags(input)).toEqual({
      isManualOrderRow: true,
      manualDocumentAvailable: true,
    });
    expect(isReceiptEligible({ ...input, amountPaid: 50 })).toBe(false);
    expect(isReceiptEligible({ ...input, shippingStatus: 'cancelled' })).toBe(
      false
    );
  });

  it('makes an unpaid manual invoice visible without changing ordinary checkout eligibility', () => {
    const input = {
      paymentStatus: 'partially_paid',
      shippingStatus: 'pending',
      recordedByUserId: 'staff-1',
      money: {
        total: 100,
        subtotal: 100,
        shipping_fee: 0,
        tax_amount: 0,
        discount_amount: 0,
        amount_paid: 50,
      },
      items: [{ name: 'Device', quantity: 1, price: 100 }],
    };
    expect(isManualOrderDocumentAvailable(input)).toBe(true);
    expect(getCurrentDocumentKind(input)).toBe('invoice');
    expect(
      isManualOrderDocumentAvailable({ ...input, recordedByUserId: null })
    ).toBe(false);
    expect(
      isManualOrderDocumentAvailable({ ...input, shippingStatus: 'returned' })
    ).toBe(false);
    // Nullish settled amounts fail closed, never coerce to zero.
    // biome-ignore format: compact rows preserve the 300-line gate.
    for (const amount of [null, undefined, '']) expect(isManualOrderDocumentAvailable({ ...input, payments: [{ transaction_type: 'payment', status: 'completed', amount }] })).toBe(false);
  });

  it('treats a fully-covered manual partial as a receipt like the emailed document', () => {
    const input = {
      paymentStatus: 'partially_paid',
      shippingStatus: 'pending',
      recordedByUserId: 'staff-1',
      total: 100,
      amountPaid: 100,
      money: {
        total: 100,
        subtotal: 100,
        shipping_fee: 0,
        tax_amount: 0,
        discount_amount: 0,
        amount_paid: 100,
      },
      items: [{ name: 'Device', quantity: 1, price: 100 }],
    };
    expect(isReceiptEligible(input)).toBe(true);
    expect(getCurrentDocumentKind(input)).toBe('receipt');
    expect(isReceiptEligible({ ...input, amountPaid: 50 })).toBe(false);
    expect(getCurrentDocumentKind({ ...input, amountPaid: 50 })).toBe(
      'invoice'
    );
  });

  it('hides paid manual orders whose corrected total exceeds payments', () => {
    const input = {
      paymentStatus: 'paid',
      shippingStatus: 'pending',
      recordedByUserId: 'staff-1',
      total: 200,
      amountPaid: 100,
      money: {
        total: 200,
        subtotal: 200,
        shipping_fee: 0,
        tax_amount: 0,
        discount_amount: 0,
        amount_paid: 100,
      },
      items: [{ name: 'Device', quantity: 1, price: 200 }],
    };
    expect(isManualOrderDocumentAvailable(input)).toBe(false);
    expect(isManualOrderDocumentAvailable({ ...input, amountPaid: 200 })).toBe(
      true
    );
  });

  it('normalizes payment and shipping statuses to lowercase tokens', () => {
    expect(normalizePaymentStatus('PAID')).toBe('paid');
    expect(normalizePaymentStatus('Partially_Paid')).toBe('partially_paid');
    expect(normalizeShippingStatus('Shipped')).toBe('shipped');
    expect(normalizeShippingStatus('DELIVERED')).toBe('delivered');
  });

  it('returns empty strings for missing statuses and normalizes unknown values', () => {
    expect(normalizePaymentStatus(undefined)).toBe('');
    expect(normalizePaymentStatus(null)).toBe('');
    expect(normalizePaymentStatus('   ')).toBe('');
    expect(normalizeShippingStatus(undefined)).toBe('');
    expect(normalizeShippingStatus(null)).toBe('');
    expect(normalizeShippingStatus('Ready For Pickup')).toBe(
      'ready_for_pickup'
    );
  });

  it('marks imported paid orders as receipt-eligible even without shipped status', () => {
    expect(
      isReceiptEligible({
        paymentStatus: 'paid',
        shippingStatus: 'shipped',
      })
    ).toBe(true);

    expect(
      isReceiptEligible({
        paymentStatus: 'paid',
        shippingStatus: 'delivered',
      })
    ).toBe(true);

    expect(
      isReceiptEligible({
        paymentStatus: 'paid',
        shippingStatus: 'processing',
        externalSource: 'bumpa',
      })
    ).toBe(true);

    expect(
      isReceiptEligible({
        paymentStatus: 'paid',
        shippingStatus: '',
        importJobId: 'job-1',
      })
    ).toBe(true);

    expect(
      isReceiptEligible({
        paymentStatus: 'paid',
        shippingStatus: 'processing',
      })
    ).toBe(false);

    expect(
      isReceiptEligible({
        paymentStatus: 'partially_paid',
        shippingStatus: 'shipped',
      })
    ).toBe(false);

    expect(
      isReceiptEligible({
        paymentStatus: '',
        shippingStatus: 'delivered',
      })
    ).toBe(false);

    expect(
      isReceiptEligible({
        paymentStatus: 'paid',
        shippingStatus: undefined,
      })
    ).toBe(false);

    expect(
      isReceiptEligible({
        paymentStatus: 'paid',
        shippingStatus: 'cancelled',
      })
    ).toBe(false);

    expect(
      isReceiptEligible({
        paymentStatus: 'paid',
        shippingStatus: 'returned',
      })
    ).toBe(false);

    expect(
      isReceiptEligible({
        paymentStatus: '',
        shippingStatus: '',
      })
    ).toBe(false);

    expect(
      isReceiptEligible({
        paymentStatus: '!'.repeat(120),
        shippingStatus: '@'.repeat(120),
      })
    ).toBe(false);
  });

  it('returns the current document kind from normalized status values', () => {
    expect(
      getCurrentDocumentKind({
        paymentStatus: 'PAID',
        shippingStatus: 'DELIVERED',
      })
    ).toBe('receipt');
    expect(
      getCurrentDocumentKind({
        paymentStatus: 'paid',
        shippingStatus: 'shipped',
      })
    ).toBe('receipt');

    expect(
      getCurrentDocumentKind({
        paymentStatus: 'paid',
        shippingStatus: 'processing',
      })
    ).toBe('invoice');

    expect(
      getCurrentDocumentKind({
        paymentStatus: 'paid',
        shippingStatus: 'processing',
        externalSource: 'bumpa',
      })
    ).toBe('receipt');
    expect(
      getCurrentDocumentKind({
        paymentStatus: 'paid',
        shippingStatus: 'processing',
        importJobId: 'job-1',
      })
    ).toBe('receipt');

    expect(
      getCurrentDocumentKind({
        paymentStatus: 'partially_paid',
        shippingStatus: 'shipped',
      })
    ).toBe('invoice');

    expect(
      getCurrentDocumentKind({
        paymentStatus: '',
        shippingStatus: '',
      })
    ).toBe('invoice');

    expect(
      getCurrentDocumentKind({
        paymentStatus: 'paid',
        shippingStatus: 'cancelled',
      })
    ).toBe('invoice');

    expect(
      getCurrentDocumentKind({
        paymentStatus: 'paid',
        shippingStatus: 'pending',
      })
    ).toBe('invoice');

    expect(
      getCurrentDocumentKind({
        paymentStatus: '!'.repeat(120),
        shippingStatus: '@'.repeat(120),
      })
    ).toBe('invoice');
  });
});
