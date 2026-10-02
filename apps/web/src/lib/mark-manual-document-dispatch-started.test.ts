import { describe, expect, it, vi } from 'vitest';
import { markManualDocumentDispatchStarted } from './mark-manual-document-dispatch-started';

const row = {
  id: 'outbox-1',
  order_id: 'order-1',
  merchant_id: 'merchant-1',
  claim_owner: 'worker-1',
};
const order = {
  customer_id: 'customer-1',
  customer_email: 'ada@example.com',
  customer_name: 'Ada',
  customer_phone: null,
  recorded_by_user_id: 'staff-1',
  import_job_id: null,
  external_source: null,
  total: 100,
  subtotal: 100,
  shipping_fee: 0,
  tax_amount: 0,
  discount_amount: 0,
  amount_paid: 100,
  currency: 'NGN',
  order_number: 'ORD-1',
  payment_status: 'paid',
  payment_method: 'bank_transfer',
  shipping_status: 'pending',
  invoice_type_code: null,
  invoice_note: null,
  notes: 'Call first',
  transaction_date: '2026-09-28T09:00:00Z',
  invoice_issue_date: null,
  shipping_address: { city: 'Lagos', postalCode: '100001' },
  order_items: [
    {
      id: 'item-1',
      name: 'Device',
      quantity: 1,
      price: 100,
      variant_name: null,
      condition: 'new',
      item_description: 'Sealed box',
    },
  ],
};

describe('markManualDocumentDispatchStarted', () => {
  it('passes the rendered snapshot to the atomic dispatch RPC', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: { status: 'marked' }, error: null });

    await expect(
      markManualDocumentDispatchStarted(
        { rpc } as never,
        row,
        order as never,
        'receipt'
      )
    ).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledWith('mark_manual_document_dispatch_started', {
      p_outbox_id: 'outbox-1',
      p_claim_owner: 'worker-1',
      p_customer_id: 'customer-1',
      p_customer_email: 'ada@example.com',
      p_customer_name: 'Ada',
      p_customer_phone: null,
      p_recorded_by_user_id: 'staff-1',
      p_import_job_id: null,
      p_external_source: null,
      p_document_kind: 'receipt',
      p_total: 100,
      p_subtotal: 100,
      p_shipping_fee: 0,
      p_tax_amount: 0,
      p_discount_amount: 0,
      p_amount_paid: 100,
      p_currency: 'NGN',
      p_order_number: 'ORD-1',
      p_payment_status: 'paid',
      p_payment_method: 'bank_transfer',
      p_shipping_status: 'pending',
      p_invoice_type_code: null,
      p_invoice_note: null,
      p_notes: 'Call first',
      p_transaction_date: '2026-09-28T09:00:00Z',
      p_invoice_issue_date: null,
      p_shipping_address: { city: 'Lagos', postalCode: '100001' },
      p_item_count: 1,
      p_items: [
        {
          id: 'item-1',
          name: 'Device',
          quantity: 1,
          price: 100,
          variant_name: null,
          condition: 'new',
          item_description: 'Sealed box',
        },
      ],
    });
  });

  it('throws when the order changed before dispatch', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: { status: 'stale' }, error: null });

    await expect(
      markManualDocumentDispatchStarted(
        { rpc } as never,
        row,
        order as never,
        'receipt'
      )
    ).rejects.toThrow('Manual document order changed before dispatch');
  });

  it('throws when the dispatch lease is lost', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: { status: 'lease_lost' }, error: null });

    await expect(
      markManualDocumentDispatchStarted(
        { rpc } as never,
        row,
        order as never,
        'receipt'
      )
    ).rejects.toThrow('Manual document dispatch lease lost');
  });

  it('throws for retry when the RPC fails', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: null, error: { message: 'boom' } });

    await expect(
      markManualDocumentDispatchStarted(
        { rpc } as never,
        row,
        order as never,
        'receipt'
      )
    ).rejects.toThrow('Manual document dispatch state unavailable');
  });
});
