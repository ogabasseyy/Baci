import { describe, expect, it } from '@jest/globals';
import type { ReceiptListItem } from '@/types/receipt';
import { resolveReceiptCardKind } from './resolve-receipt-card-kind';

const manualItem: ReceiptListItem = {
  id: 'order-1',
  order_number: 'ORD-100',
  payment_status: 'paid',
  shipping_status: 'pending',
  total: 150000,
  subtotal: 150000,
  shipping_fee: 0,
  tax_amount: 0,
  discount_amount: 0,
  amount_paid: 150000,
  currency: 'NGN',
  recorded_by_user_id: 'staff-1',
  import_job_id: null,
  external_source: null,
  created_at: '2026-08-01T12:00:00.000Z',
  items: [
    {
      id: 'item-1',
      product_name: 'Test Phone',
      quantity: 1,
      price: 150000,
    },
  ],
  document_kind: 'receipt',
};

describe('resolveReceiptCardKind', () => {
  it('keeps a valid manual receipt', () => {
    expect(resolveReceiptCardKind(manualItem)).toBe('receipt');
  });

  it('demotes a stale receipt on terminal shipping', () => {
    expect(
      resolveReceiptCardKind({ ...manualItem, shipping_status: 'cancelled' })
    ).toBe('invoice');
  });

  it('demotes a receipt on corrupt money', () => {
    expect(resolveReceiptCardKind({ ...manualItem, total: Number.NaN })).toBe(
      'invoice'
    );
  });

  it('keeps a non-manual receipt kind untouched', () => {
    expect(
      resolveReceiptCardKind({ ...manualItem, recorded_by_user_id: null })
    ).toBe('receipt');
  });

  it('keeps a stale invoice demote-only', () => {
    expect(
      resolveReceiptCardKind({ ...manualItem, document_kind: 'invoice' })
    ).toBe('invoice');
  });

  it('passes an absent legacy kind through', () => {
    const { document_kind: _dropped, ...legacy } = manualItem;
    expect(resolveReceiptCardKind(legacy)).toBeUndefined();
  });
});
