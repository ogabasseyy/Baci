import { describe, expect, it } from 'vitest';
import { buildImmediatePeppolInvoiceData } from './invoice-data';

type InvoiceInput = Parameters<typeof buildImmediatePeppolInvoiceData>[0];

function baseInput(): InvoiceInput {
  return {
    customerEmail: 'buyer@example.com',
    customerName: 'Ada Buyer',
    fulfillment: null,
    items: [
      {
        id: 'item-1',
        product_id: 'p1',
        name: 'Phone',
        price: 20000,
        quantity: 1,
        has_assurance: false,
      },
    ],
    merchant: { business_name: 'Test Store' },
    order: { currency: 'NGN', tax_amount: 0, discount_amount: 0 },
    orderNumber: 'BAC-001',
    orderShippingFee: 1500,
    orderSubtotal: 20000,
    orderTotal: 21500,
    paymentAccount: null,
    shippingAddress: {
      address: '12 Market St',
      city: 'Lagos',
      state: 'Lagos',
    },
  } as never;
}

describe('buildImmediatePeppolInvoiceData', () => {
  it('builds line items with extension amounts and NGN default', () => {
    const invoice = buildImmediatePeppolInvoiceData(baseInput());

    expect(invoice.items).toHaveLength(1);
    expect(invoice.items[0]).toMatchObject({
      line_id: 1,
      quantity: 1,
      line_extension_amount: 20000,
    });
    expect(invoice.currency).toBe('NGN');
  });

  it('keeps the stamped order currency and computes exclusive totals', () => {
    const invoice = buildImmediatePeppolInvoiceData({
      ...baseInput(),
      order: { currency: 'KES', tax_amount: 0, discount_amount: 0 },
    });

    expect(invoice.currency).toBe('KES');
    expect(invoice.tax_exclusive_amount).toBe(21500);
  });
});
