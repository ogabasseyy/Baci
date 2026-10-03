import { describe, expect, it } from 'vitest';
import { transformStorefrontOrdersForDisplay } from './storefront-orders-transform';

const lookups = {
  transactionsByOrderId: new Map([
    [
      'order-1',
      [
        {
          id: 'txn-1',
          order_id: 'order-1',
          amount: 150000,
          created_at: '2026-09-30T12:00:00Z',
          description: 'Transfer',
          metadata: null,
          gateway: 'paystack',
          status: 'completed',
          transaction_type: 'payment',
        },
        {
          id: 'txn-2',
          order_id: 'order-1',
          amount: 1000,
          created_at: '2026-09-30T13:00:00Z',
          description: 'Retry hold',
          metadata: null,
          gateway: 'paystack',
          status: 'pending',
          transaction_type: 'payment',
        },
      ],
    ],
  ]),
  paymentAccountsByOrderId: new Map([
    [
      'order-1',
      {
        account_number: '9876543210',
        bank_name: 'DVA Bank',
        account_name: 'Ada / ORD-42',
      },
    ],
  ]),
};

describe('transformStorefrontOrdersForDisplay', () => {
  it('projects dates, accounts, items, and manual flags', () => {
    const [entry] = transformStorefrontOrdersForDisplay(
      [
        {
          id: 'order-1',
          order_number: 'ORD-42',
          created_at: '2026-09-22T10:00:00.000Z',
          transaction_date: '2026-09-28T09:00:00Z',
          invoice_issue_date: null,
          total: 150000,
          subtotal: 150000,
          shipping_fee: 0,
          tax_amount: 0,
          discount_amount: 0,
          amount_paid: 150000,
          currency: 'NGN',
          recorded_by_user_id: 'staff-1',
          payment_status: 'paid',
          shipping_status: 'pending',
          payment_method: 'paystack',
          customer_name: 'Ada Lovelace',
          customer_email: 'ada@example.com',
          customer_phone: '+2348000000003',
          order_items: [
            {
              id: 'item-1',
              name: 'Pixel 10 Pro XL',
              quantity: 1,
              price: 150000,
              image_url: null,
              products: {
                slug: 'pixel-10-pro-xl',
                images: ['https://cdn.example.com/pixel.jpg', ''],
                categories: { name: 'Smartphones', slug: 'smartphones' },
              },
            },
          ],
        },
      ],
      lookups
    );

    expect(entry.receipt_completion_date).toBe('2026-09-30T12:00:00Z');
    // Settled payments project for the preview Payment table; unsettled
    // rows never reach the model.
    expect(entry.transactions).toEqual([
      {
        amount: 150000,
        created_at: '2026-09-30T12:00:00Z',
        description: 'Transfer',
        metadata: null,
      },
    ]);
    expect(entry.virtual_account).toMatchObject({
      account_number: '9876543210',
    });
    expect(entry.balance).toBe(0);
    expect(entry.is_manual_order).toBe(true);
    expect(entry.customer_name).toBe('Ada Lovelace');
    expect(entry.customer_email).toBe('ada@example.com');
    expect(entry.customer_phone).toBe('+2348000000003');
    expect(entry.items).toEqual([
      expect.objectContaining({
        image_url: 'https://cdn.example.com/pixel.jpg',
        product_images: ['https://cdn.example.com/pixel.jpg'],
        product_slug: 'pixel-10-pro-xl',
        category_slug: 'smartphones',
      }),
    ]);
  });

  it('projects item assurance fees for the preview lines', () => {
    const [entry] = transformStorefrontOrdersForDisplay(
      [
        {
          id: 'order-3',
          order_items: [
            {
              id: 'item-9',
              name: 'Pixel 10 Pro XL',
              quantity: 1,
              price: 150000,
              assurance_fee: 15000,
            },
          ],
        },
      ],
      { transactionsByOrderId: new Map(), paymentAccountsByOrderId: new Map() }
    );

    expect(entry.items[0]).toMatchObject({ assurance_fee: 15000 });
  });

  it('selects null when the order has no completion transaction', () => {
    const [entry] = transformStorefrontOrdersForDisplay(
      [{ id: 'order-2', total: 5000, amount_paid: 0 }],
      { transactionsByOrderId: new Map(), paymentAccountsByOrderId: new Map() }
    );

    expect(entry.receipt_completion_date).toBeNull();
    expect(entry.virtual_account).toBeNull();
    expect(entry.balance).toBe(5000);
  });
});
