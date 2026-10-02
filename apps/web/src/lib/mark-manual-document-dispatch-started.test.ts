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
  total: 100,
  amount_paid: 100,
  payment_status: 'paid',
  shipping_status: 'pending',
  order_items: [
    {
      id: 'item-1',
      name: 'Device',
      quantity: 1,
      price: 100,
      variant_name: null,
      condition: 'new',
    },
  ],
};

describe('markManualDocumentDispatchStarted', () => {
  it('passes the rendered snapshot to the atomic dispatch RPC', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: { status: 'marked' }, error: null });

    await expect(
      markManualDocumentDispatchStarted({ rpc } as never, row, order as never)
    ).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledWith('mark_manual_document_dispatch_started', {
      p_outbox_id: 'outbox-1',
      p_claim_owner: 'worker-1',
      p_customer_id: 'customer-1',
      p_customer_email: 'ada@example.com',
      p_total: 100,
      p_amount_paid: 100,
      p_payment_status: 'paid',
      p_shipping_status: 'pending',
      p_item_count: 1,
      p_items: [
        {
          id: 'item-1',
          name: 'Device',
          quantity: 1,
          price: 100,
          variant_name: null,
          condition: 'new',
        },
      ],
    });
  });

  it('throws when the order changed before dispatch', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: { status: 'stale' }, error: null });

    await expect(
      markManualDocumentDispatchStarted({ rpc } as never, row, order as never)
    ).rejects.toThrow('Manual document order changed before dispatch');
  });

  it('throws when the dispatch lease is lost', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: { status: 'lease_lost' }, error: null });

    await expect(
      markManualDocumentDispatchStarted({ rpc } as never, row, order as never)
    ).rejects.toThrow('Manual document dispatch lease lost');
  });

  it('throws for retry when the RPC fails', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: null, error: { message: 'boom' } });

    await expect(
      markManualDocumentDispatchStarted({ rpc } as never, row, order as never)
    ).rejects.toThrow('Manual document dispatch state unavailable');
  });
});
