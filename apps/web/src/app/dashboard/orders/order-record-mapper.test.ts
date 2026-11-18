import { getCancelRefundPlan } from '@baci/shared';
import { describe, expect, it } from 'vitest';
import { mapDashboardOrderRecord } from './order-record-mapper';

const baseOrder = {
  id: 'order-1',
  order_number: '#1001',
  customer_name: 'Ada Lovelace',
  total: '35000',
  subtotal: '30000',
  shipping_fee: '1500',
  gift_wrapping_fee: '500',
  tax_amount: '3000',
  tax_basis: 'inclusive',
  discount_amount: '1000',
  currency: 'NGN',
  shipping_status: 'shipped',
  payment_status: 'paid',
  payment_method: 'card',
  created_at: '2026-01-01T00:00:00.000Z',
  source: 'storefront',
  delivery_method: 'airport',
  airport_type: 'delivery',
  order_items: [
    {
      id: 'item-1',
      name: 'Phone',
      product_id: 'product-1',
      quantity: 2,
      price: '1000',
      image_url: null,
      variant_name: 'Black',
      has_assurance: true,
    },
  ],
};

describe('mapDashboardOrderRecord', () => {
  it('propagates the synced marketplace shop id for fulfillment', () => {
    const result = mapDashboardOrderRecord(
      {
        ...baseOrder,
        source: 'jumia',
        import_metadata: {
          platform: 'jumia',
          shopId: 'shop-9',
          marketplaceKey: 'NG-main',
          jumiaOrderId: 'provider-123',
        },
      },
      { orderItemImageMap: new Map() }
    );

    expect(result).toEqual(
      expect.objectContaining({
        id: 'order-1',
        jumiaShopId: 'shop-9',
        jumiaMarketplaceKey: 'NG-main',
        jumiaOrderId: 'provider-123',
      })
    );
  });

  it('leaves the shop id undefined without marketplace metadata', () => {
    const result = mapDashboardOrderRecord(baseOrder, {
      orderItemImageMap: new Map(),
    });

    expect(result).toEqual(expect.objectContaining({ jumiaShopId: undefined }));
  });

  it('preserves airport delivery metadata and uses the product image fallback', () => {
    const result = mapDashboardOrderRecord(baseOrder, {
      orderItemImageMap: new Map([
        ['product-1', 'https://example.com/phone.jpg'],
      ]),
    });

    expect(result).toEqual(
      expect.objectContaining({
        delivery_method: 'airport',
        airport_type: 'delivery',
        items: [
          expect.objectContaining({
            image: 'https://example.com/phone.jpg',
            hasAssurance: true,
          }),
        ],
      })
    );
  });

  it('maps order details and transaction history when requested', () => {
    const result = mapDashboardOrderRecord(
      {
        ...baseOrder,
        shipping_rate_id: 'rate-1',
        shipping_rate_name: 'Lagos pickup',
        payment_reference: 'pay-1',
        customer_email: 'ada@example.com',
        customer_phone: '08000000000',
        notes: 'Call on arrival',
      },
      {
        includeDetails: true,
        orderItemImageMap: new Map(),
        transactions: [
          {
            id: 'transaction-1',
            gateway_reference: 'gateway-1',
            transaction_type: 'payment',
            status: 'success',
            amount: 35000,
            currency: 'NGN',
            gateway: 'paystack',
            created_at: '2026-01-01T00:00:00.000Z',
          },
        ],
      }
    );

    expect(result).toEqual(
      expect.objectContaining({
        shipping_rate_id: 'rate-1',
        shipping_rate_name: 'Lagos pickup',
        payment_reference: 'pay-1',
        transactions: [
          expect.objectContaining({
            reference: 'gateway-1',
            transaction_type: 'payment',
          }),
        ],
      })
    );
  });

  it('passes the refund-coverage fields through to the cancel plan', () => {
    const mapped = mapDashboardOrderRecord(baseOrder, {
      includeDetails: true,
      orderItemImageMap: new Map(),
      transactions: [
        {
          amount: 5000,
          created_at: '2026-01-01T00:00:00.000Z',
          currency: 'NGN',
          gateway: 'paystack',
          gateway_reference: 'ref-1',
          id: 'leg-1',
          status: 'completed',
          transaction_type: 'payment',
        },
        {
          amount: 5000,
          created_at: '2026-01-02T00:00:00.000Z',
          currency: 'NGN',
          gateway: 'paystack',
          id: 'refund-1',
          payment_transaction_id: 'leg-1',
          status: 'completed',
          transaction_type: 'refund',
        },
      ],
    });

    expect(mapped.transactions?.[0]).toMatchObject({
      gateway_reference: 'ref-1',
    });
    expect(mapped.transactions?.[1]).toMatchObject({
      payment_transaction_id: 'leg-1',
    });
    // The covered leg leaves nothing for a cancellation to refund.
    expect(
      getCancelRefundPlan({ ...mapped, paymentStatus: 'Paid' }).amount
    ).toBe(0);
  });

  it('maps persisted financial fields for dashboard order history', () => {
    const result = mapDashboardOrderRecord(baseOrder, {
      orderItemImageMap: new Map(),
    });

    expect(result).toEqual(
      expect.objectContaining({
        subtotal: 30000,
        shipping_fee: 1500,
        gift_wrapping_fee: 500,
        tax_amount: 3000,
        tax_basis: 'inclusive',
        discount_amount: 1000,
      })
    );
  });

  it('preserves a missing currency as null so renderers use the merchant fallback', () => {
    const result = mapDashboardOrderRecord(
      { ...baseOrder, currency: null },
      { orderItemImageMap: new Map() }
    );

    expect(result.currency).toBeNull();
  });

  it('maps the recorded amount paid, null when absent or unreadable', () => {
    const map = (amount_paid: unknown) =>
      mapDashboardOrderRecord({ ...baseOrder, amount_paid } as never, {
        orderItemImageMap: new Map(),
      }).amountPaid;
    expect(map('5000.50')).toBe(5000.5);
    expect(map(null)).toBeNull();
    expect(map(undefined)).toBeNull();
    expect(map('abc')).toBeNull();
  });
});
