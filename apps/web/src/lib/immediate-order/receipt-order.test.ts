import { describe, expect, it } from 'vitest';
import { buildInvoiceReceiptOrder } from './receipt-order';

type ReceiptInput = Parameters<typeof buildInvoiceReceiptOrder>[0];

function baseInput(): ReceiptInput {
  return {
    ctx: {
      order: {
        id: 'order-1',
        created_at: '2026-01-01T00:00:00.000Z',
        payment_status: 'unpaid',
        tax_amount: 0,
        discount_amount: 0,
      },
      orderNum: 'BAC-001',
      orderCurrency: 'NGN',
      orderTotal: 21500,
      orderSubtotal: 20000,
      orderShippingFee: 1500,
      effectivePaymentMethod: 'invoice',
      customerName: 'Ada Buyer',
      customerEmail: 'buyer@example.com',
      immediateEmail: { isPaidForEmail: false },
      shippingAddress: {
        address: '12 Market St',
        city: 'Lagos',
        state: 'Lagos',
      },
    },
    invoiceItems: [
      {
        id: 'item-1',
        product_id: 'p1',
        name: 'Phone',
        quantity: 1,
        price: 20000,
      },
    ],
    fulfillment: null,
    hasDeviceItem: false,
    amountPaid: 0,
    invoiceVirtualAccount: null,
  } as never;
}

describe('buildInvoiceReceiptOrder', () => {
  it('shapes persisted items into receipt lines with the balance', () => {
    const receipt = buildInvoiceReceiptOrder(baseInput());

    expect(receipt).toMatchObject({
      order_number: 'BAC-001',
      currency: 'NGN',
      total: 21500,
      amount_paid: 0,
      balance: 21500,
      payment_status: 'unpaid',
    });
    expect(receipt.items).toHaveLength(1);
    expect(receipt.items[0]).toMatchObject({
      line_id: 1,
      product_id: 'p1',
      quantity: 1,
      price: 20000,
    });
  });

  it('marks paid orders and carries the virtual account', () => {
    const virtualAccount = { account_number: '0199999999' };
    const receipt = buildInvoiceReceiptOrder({
      ...baseInput(),
      amountPaid: 21500,
      invoiceVirtualAccount: virtualAccount as never,
      ctx: {
        ...baseInput().ctx,
        immediateEmail: {
          ...baseInput().ctx.immediateEmail,
          isPaidForEmail: true,
        },
      },
    });

    expect(receipt.payment_status).toBe('paid');
    expect(receipt.balance).toBe(0);
    expect(receipt.virtual_account).toBe(virtualAccount);
  });
});
