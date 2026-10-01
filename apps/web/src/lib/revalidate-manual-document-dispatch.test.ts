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

const renderedOrder = {
  id: 'order-1',
  merchant_id: 'merchant-1',
  customer_id: 'customer-1',
  customer_email: 'ada@example.com',
  total: 100,
  amount_paid: 100,
  payment_status: 'paid',
  shipping_status: 'pending',
  order_items: [{ id: 'item-1' }],
};
const freshRow = {
  customer_id: 'customer-1',
  customer_email: 'ada@example.com',
  total: 100,
  amount_paid: 100,
  payment_status: 'paid',
  shipping_status: 'pending',
  order_items: [{ id: 'item-1' }],
};

describe('revalidateManualDocumentDispatchState', () => {
  it('resolves when the fresh snapshot matches the render', async () => {
    const { client, from } = clientReturning({
      data: freshRow,
      error: null,
    });

    await expect(
      revalidateManualDocumentDispatchState(client as never, renderedOrder)
    ).resolves.toBeUndefined();
    expect(from).toHaveBeenCalledWith('orders');
  });

  it('ignores a case-only email correction to the same mailbox', async () => {
    const { client } = clientReturning({
      data: { ...freshRow, customer_email: 'ADA@EXAMPLE.COM' },
      error: null,
    });

    await expect(
      revalidateManualDocumentDispatchState(client as never, renderedOrder)
    ).resolves.toBeUndefined();
  });

  it('throws when the recipient changed after the claim', async () => {
    const { client } = clientReturning({
      data: { ...freshRow, customer_email: 'someone-else@example.com' },
      error: null,
    });

    await expect(
      revalidateManualDocumentDispatchState(client as never, renderedOrder)
    ).rejects.toThrow('Manual document order changed before dispatch');
  });

  it('throws when the customer was reassigned after the claim', async () => {
    const { client } = clientReturning({
      data: { ...freshRow, customer_id: 'customer-2' },
      error: null,
    });

    await expect(
      revalidateManualDocumentDispatchState(client as never, renderedOrder)
    ).rejects.toThrow('Manual document order changed before dispatch');
  });

  it('throws on invoice-balance drift without a paid flip', async () => {
    const { client } = clientReturning({
      data: {
        ...freshRow,
        payment_status: 'unpaid',
        amount_paid: 80,
      },
      error: null,
    });
    const renderedInvoice = {
      ...renderedOrder,
      payment_status: 'unpaid',
      amount_paid: 60,
    };

    await expect(
      revalidateManualDocumentDispatchState(client as never, renderedInvoice)
    ).rejects.toThrow('Manual document order changed before dispatch');
  });

  it('throws when payment landed after an invoice render', async () => {
    const { client } = clientReturning({ data: freshRow, error: null });
    const renderedInvoice = {
      ...renderedOrder,
      payment_status: 'unpaid',
      amount_paid: 0,
    };

    await expect(
      revalidateManualDocumentDispatchState(client as never, renderedInvoice)
    ).rejects.toThrow('Manual document order changed before dispatch');
  });

  it('throws when items changed after the render', async () => {
    const { client } = clientReturning({
      data: { ...freshRow, order_items: [{ id: 'item-1' }, { id: 'item-2' }] },
      error: null,
    });

    await expect(
      revalidateManualDocumentDispatchState(client as never, renderedOrder)
    ).rejects.toThrow('Manual document order changed before dispatch');
  });

  it('throws when the order was cancelled after the claim', async () => {
    const { client } = clientReturning({
      data: { ...freshRow, shipping_status: 'cancelled' },
      error: null,
    });

    await expect(
      revalidateManualDocumentDispatchState(client as never, renderedOrder)
    ).rejects.toThrow('Manual document order changed before dispatch');
  });

  it('throws when the order row is gone', async () => {
    const { client } = clientReturning({ data: null, error: null });

    await expect(
      revalidateManualDocumentDispatchState(client as never, renderedOrder)
    ).rejects.toThrow('Manual document order changed before dispatch');
  });

  it('throws for retry when the lookup fails', async () => {
    const { client } = clientReturning({
      data: null,
      error: { message: 'boom' },
    });

    await expect(
      revalidateManualDocumentDispatchState(client as never, renderedOrder)
    ).rejects.toThrow('Manual document dispatch state unavailable');
  });
});
