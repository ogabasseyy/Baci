import { describe, expect, it, vi } from 'vitest';
import { revalidateManualDocumentDispatchState } from './revalidate-manual-document-dispatch';

function clientReturning(result: unknown) {
  const terminal = { maybeSingle: vi.fn().mockResolvedValue(result) };
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: terminal.maybeSingle,
  };
  const from = vi.fn().mockReturnValue(chain);
  return { client: { from }, from };
}

const receiptRow = {
  order_id: 'order-1',
  merchant_id: 'merchant-1',
  event_type: 'manual_order_receipt' as const,
};
const invoiceRow = {
  order_id: 'order-1',
  merchant_id: 'merchant-1',
  event_type: 'manual_order_invoice' as const,
};

describe('revalidateManualDocumentDispatchState', () => {
  it('resolves when the fresh state matches the receipt row', async () => {
    const { client, from } = clientReturning({
      data: {
        payment_status: 'paid',
        amount_paid: 100,
        total: 100,
        shipping_status: 'pending',
      },
      error: null,
    });

    await expect(
      revalidateManualDocumentDispatchState(client as never, receiptRow)
    ).resolves.toBeUndefined();
    expect(from).toHaveBeenCalledWith('orders');
  });

  it('throws when the order was paid under an invoice row', async () => {
    const { client } = clientReturning({
      data: {
        payment_status: 'paid',
        amount_paid: 100,
        total: 100,
        shipping_status: 'pending',
      },
      error: null,
    });

    await expect(
      revalidateManualDocumentDispatchState(client as never, invoiceRow)
    ).rejects.toThrow('Manual document order changed before dispatch');
  });

  it('throws when a receipt row no longer covers the total', async () => {
    const { client } = clientReturning({
      data: {
        payment_status: 'paid',
        amount_paid: 60,
        total: 100,
        shipping_status: 'pending',
      },
      error: null,
    });

    await expect(
      revalidateManualDocumentDispatchState(client as never, receiptRow)
    ).rejects.toThrow('Manual document order changed before dispatch');
  });

  it('throws when the order was cancelled after the claim', async () => {
    const { client } = clientReturning({
      data: {
        payment_status: 'paid',
        amount_paid: 100,
        total: 100,
        shipping_status: 'cancelled',
      },
      error: null,
    });

    await expect(
      revalidateManualDocumentDispatchState(client as never, receiptRow)
    ).rejects.toThrow('Manual document order changed before dispatch');
  });

  it('throws when the order row is gone', async () => {
    const { client } = clientReturning({ data: null, error: null });

    await expect(
      revalidateManualDocumentDispatchState(client as never, receiptRow)
    ).rejects.toThrow('Manual document order changed before dispatch');
  });

  it('throws for retry when the lookup fails', async () => {
    const { client } = clientReturning({
      data: null,
      error: { message: 'boom' },
    });

    await expect(
      revalidateManualDocumentDispatchState(client as never, receiptRow)
    ).rejects.toThrow('Manual document dispatch state unavailable');
  });
});
