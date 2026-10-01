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
  it('includes receipt-eligible and manual-document orders', () => {
    expect(isArchiveOrder({ ...baseOrder, receipt_eligible: true })).toBe(true);
    expect(
      isArchiveOrder({ ...baseOrder, manual_document_available: true })
    ).toBe(true);
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
});
