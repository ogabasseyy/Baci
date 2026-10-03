import { describe, expect, it } from 'vitest';
import type { StorefrontOrder } from '@/types/storefront-order';
import { isArchiveOrder } from './archive-order-filter';

const baseOrder = {
  receipt_eligible: false,
  manual_document_available: false,
  shipping_status: 'pending',
  payment_method: 'card',
  paymentMethod: 'card',
} as StorefrontOrder;

describe('isArchiveOrder', () => {
  it('includes receipt-eligible orders', () => {
    expect(isArchiveOrder({ ...baseOrder, receipt_eligible: true })).toBe(true);
  });

  it('ignores the manual flag on non-manual orders', () => {
    expect(
      isArchiveOrder({ ...baseOrder, manual_document_available: true })
    ).toBe(false);
  });

  it('includes shipped, delivered, and invoice-method orders', () => {
    expect(isArchiveOrder({ ...baseOrder, shipping_status: 'shipped' })).toBe(
      true
    );
    expect(isArchiveOrder({ ...baseOrder, shipping_status: 'delivered' })).toBe(
      true
    );
    expect(isArchiveOrder({ ...baseOrder, payment_method: 'invoice' })).toBe(
      true
    );
    expect(isArchiveOrder({ ...baseOrder, paymentMethod: 'invoice' })).toBe(
      true
    );
  });

  it('excludes ordinary pending orders', () => {
    expect(isArchiveOrder(baseOrder)).toBe(false);
  });

  it('fails invalid manual orders closed before the legacy branches', () => {
    const invalidManual = {
      ...baseOrder,
      is_manual_order: true,
      receipt_eligible: false,
      manual_document_available: false,
    };
    expect(
      isArchiveOrder({ ...invalidManual, shipping_status: 'shipped' })
    ).toBe(false);
    expect(
      isArchiveOrder({ ...invalidManual, payment_method: 'invoice' })
    ).toBe(false);
  });

  it('keeps valid manual orders admitted by the availability gate', () => {
    expect(
      isArchiveOrder({
        ...baseOrder,
        is_manual_order: true,
        manual_document_available: true,
      })
    ).toBe(true);
  });

  it('matches legacy payment-method spellings like shipping status', () => {
    for (const method of ['Invoice', 'INVOICE', '  invoice  ']) {
      expect(isArchiveOrder({ ...baseOrder, payment_method: method })).toBe(
        true
      );
      expect(isArchiveOrder({ ...baseOrder, paymentMethod: method })).toBe(
        true
      );
    }
  });
});
