import { describe, expect, it } from 'vitest';
import { mapTransactionOrderRows } from './transaction-review';

describe('transaction review discount mapping', () => {
  it('keeps VAT relief out of merchandise profit for auto-negotiated orders', () => {
    const row = {
      created_at: '2026-07-01T12:30:00.000Z',
      customer_email: null,
      customer_name: 'Negotiated Customer',
      customer_phone: null,
      ad_tracking: {
        baci_transaction_discount: {
          lineDiscounts: [
            { lineId: 1, merchandiseDiscount: 2, vatRelief: 0.15 },
          ],
          version: 2,
        },
      },
      discount_amount: 2.15,
      discount_code_id: null,
      fulfillment_details: null,
      id: 'order-negotiated',
      order_items: [
        {
          cost_price: 50,
          fulfillment_data: null,
          id: 'item-negotiated',
          line_id: 1,
          name: 'Negotiated Product',
          price: 100,
          product_id: 'product-negotiated',
          products: null,
          quantity: 1,
          vat_category_code: 'S',
          vat_rate: 7.5,
        },
      ],
      order_number: 'ORD-NEGOTIATED',
      payment_method: 'card',
      source: 'online_store',
      total: 100,
    };

    const [order] = mapTransactionOrderRows([row]);

    expect(order.items[0]).toMatchObject({
      profit: 48,
      revenue: 98,
    });
  });

  it('keeps VAT relief out of merchandise profit for pre-metadata negotiated orders', () => {
    const row = {
      created_at: '2026-07-01T12:30:00.000Z',
      customer_email: null,
      customer_name: 'Legacy Negotiated Customer',
      customer_phone: null,
      discount_amount: 2.15,
      discount_code_id: null,
      fulfillment_details: null,
      id: 'order-legacy-negotiated',
      order_items: [
        {
          cost_price: 50,
          fulfillment_data: null,
          id: 'item-legacy-negotiated',
          name: 'Legacy Negotiated Product',
          price: 100,
          product_id: 'product-legacy-negotiated',
          products: null,
          quantity: 1,
          vat_category_code: 'S',
          vat_rate: 7.5,
        },
      ],
      order_number: 'ORD-LEGACY-NEGOTIATED',
      payment_method: 'card',
      source: 'online_store',
      tax_amount: 7.5,
      total: 100,
    };

    const [order] = mapTransactionOrderRows([row]);

    expect(order.items[0]).toMatchObject({
      profit: 48,
      revenue: 98,
    });
  });

  it('does not discount assurance when mapping a legacy non-VAT negotiation', () => {
    const [order] = mapTransactionOrderRows([
      {
        created_at: '2026-07-01T12:30:00.000Z',
        customer_email: null,
        customer_name: 'Legacy Non-VAT Customer',
        customer_phone: null,
        discount_amount: 2,
        discount_code_id: null,
        fulfillment_details: null,
        id: 'order-legacy-non-vat',
        order_items: [
          {
            assurance_fee: 10,
            cost_price: 50,
            fulfillment_data: null,
            id: 'item-legacy-non-vat',
            name: 'Legacy Non-VAT Product',
            price: 100,
            product_id: 'product-legacy-non-vat',
            products: null,
            quantity: 1,
          },
        ],
        order_number: 'ORD-LEGACY-NON-VAT',
        payment_method: 'card',
        source: 'online_store',
        tax_amount: 0,
        total: 108,
      },
    ]);

    expect(order.items[0]).toMatchObject({
      profit: 48,
      revenue: 98,
    });
  });

  it('does not gross up a manual discount on a physical order', () => {
    const row = {
      created_at: '2026-07-01T12:30:00.000Z',
      customer_email: null,
      customer_name: 'Manual Discount Customer',
      customer_phone: null,
      discount_amount: 2.15,
      discount_code_id: null,
      fulfillment_details: null,
      id: 'order-manual-discount',
      order_items: [
        {
          cost_price: 50,
          fulfillment_data: null,
          id: 'item-manual-discount',
          name: 'Manual Discount Product',
          price: 100,
          product_id: 'product-manual-discount',
          products: null,
          quantity: 1,
          vat_category_code: 'S',
          vat_rate: 7.5,
        },
      ],
      order_number: 'ORD-MANUAL-DISCOUNT',
      payment_method: 'card',
      source: 'physical',
      total: 100,
    };

    const [order] = mapTransactionOrderRows([row]);

    expect(order.items[0]?.revenue).toBeCloseTo(97.85, 2);
    expect(order.items[0]?.profit).toBeCloseTo(47.85, 2);
  });

  it('keeps assurance fees out of admin-edited discount allocation', () => {
    const [order] = mapTransactionOrderRows([
      {
        ad_tracking: {
          baci_transaction_discount: {
            status: 'admin_edit',
            version: 4,
          },
        },
        created_at: '2026-08-30T12:30:00.000Z',
        customer_email: null,
        customer_name: 'Admin Edited Discount Customer',
        customer_phone: null,
        discount_amount: 20,
        discount_code_id: null,
        fulfillment_details: null,
        id: 'order-admin-edited-discount',
        order_items: [
          {
            assurance_fee: 10,
            cost_price: 50,
            fulfillment_data: null,
            id: 'item-admin-edited-discount',
            name: 'Admin Edited Product',
            price: 100,
            product_id: 'product-admin-edited-discount',
            products: null,
            quantity: 1,
          },
        ],
        order_number: 'ORD-ADMIN-EDITED-DISCOUNT',
        payment_method: 'card',
        source: 'online_store',
        total: 90,
      },
    ]);

    expect(order.items[0]).toMatchObject({
      profit: 30,
      revenue: 80,
    });
  });
});
