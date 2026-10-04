import { describe, expect, it } from 'vitest';
import { renderItemRows } from './receipt-item-rows';
import type { ReceiptOrder } from './types';

const formatMoney = (value: number) => `NGN ${value.toLocaleString('en-NG')}`;

function createReceiptOrder(
  overrides: Partial<ReceiptOrder> = {}
): ReceiptOrder {
  return {
    amount_paid: 500000,
    balance: 0,
    created_at: '2026-04-08T18:02:55.974Z',
    currency: 'NGN',
    customer_email: 'customer@example.com',
    customer_name: 'Customer Example',
    customer_phone: null,
    discount_amount: 0,
    items: [
      {
        price: 500000,
        product_name: 'Samsung Galaxy Fold 5',
        quantity: 1,
      },
    ],
    order_number: 'ORD-123',
    payment_method: 'card',
    payment_status: 'paid',
    shipping_fee: 0,
    subtotal: 500000,
    tax_amount: 0,
    total: 500000,
    ...overrides,
  };
}

describe('renderItemRows', () => {
  it('renders item descriptions under the receipt item name', () => {
    const html = renderItemRows(
      createReceiptOrder({
        items: [
          {
            description: 'Unlocked 512GB device',
            price: 930000,
            product_name: 'Samsung Galaxy Fold 5',
            quantity: 1,
            variant_name: 'Used',
          },
        ],
      }),
      formatMoney,
      'receipt'
    );

    expect(html).toContain('Samsung Galaxy Fold 5 (Used)');
    expect(html).toContain('Unlocked 512GB device');
    expect(html).toContain('cell-item-description');
  });

  it('honors explicit line extensions and renders SKU/Unit/VAT detail lines', () => {
    const html = renderItemRows(
      createReceiptOrder({
        items: [
          {
            price: 1000,
            product_name: 'Samsung Galaxy Fold 5',
            quantity: 2,
            line_extension_amount: 1500,
            sellers_item_id: 'SKU-1',
            unit_code: 'EA',
            vat_category_code: 'S',
            vat_rate: 7.5,
            vat_amount: 112.5,
          },
        ],
      }),
      formatMoney,
      'invoice'
    );

    // The explicit extension wins over quantity x price like the emailed PDF.
    expect(html).toContain('NGN 1,500');
    expect(html).not.toContain('NGN 2,000');
    expect(html).toContain('cell-line-meta');
    expect(html).toContain('SKU: SKU-1');
    expect(html).toContain('Unit: EA');
    expect(html).toContain('VAT: 7.50%');
    expect(html).toContain('NGN 112.5');
  });

  it('falls back to quantity x price without an extension or meta lines', () => {
    const html = renderItemRows(
      createReceiptOrder({
        items: [{ price: 1000, product_name: 'Cable', quantity: 2 }],
      }),
      formatMoney,
      'receipt'
    );

    expect(html).toContain('NGN 2,000');
    expect(html).not.toContain('cell-line-meta');
  });

  it('omits duplicate item descriptions already visible as labels or fulfillment', () => {
    const html = renderItemRows(
      createReceiptOrder({
        items: [
          {
            description: 'Used\nIMEI: 353456789012345 | S/N: SN-123',
            fulfillment_details: {
              imei: '353456789012345',
              serialNumber: 'SN-123',
            },
            price: 930000,
            product_name: 'Samsung Galaxy Fold 5',
            quantity: 1,
            variant_name: 'Used',
          },
        ],
      }),
      formatMoney,
      'receipt'
    );

    expect(html.match(/Samsung Galaxy Fold 5 \(Used\)/g) ?? []).toHaveLength(1);
    expect(html.match(/IMEI: 353456789012345/g) ?? []).toHaveLength(1);
    expect(html).not.toContain('cell-item-description');
  });

  it('hides VAT lines on receipt previews like the emailed receipt', () => {
    const html = renderItemRows(
      createReceiptOrder({
        items: [
          {
            price: 1000,
            product_name: 'Cable',
            quantity: 1,
            vat_rate: 7.5,
            vat_amount: 75,
          },
        ],
      }),
      formatMoney,
      'receipt'
    );

    expect(html).not.toContain('VAT: 7.50%');
    expect(html).not.toContain('cell-line-meta');
  });

  it('shows VAT lines on proforma previews like invoices', () => {
    const html = renderItemRows(
      createReceiptOrder({
        items: [
          {
            price: 1000,
            product_name: 'Cable',
            quantity: 1,
            vat_rate: 7.5,
            vat_amount: 75,
          },
        ],
      }),
      formatMoney,
      'proforma'
    );

    expect(html).toContain('VAT: 7.50%');
  });
});
