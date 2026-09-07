import { describe, expect, it } from 'vitest';
import {
  toRichPaidOrder,
  toRichPaidOrderItems,
} from '@/lib/payments/paid-order-normalization';

describe('paid order normalization', () => {
  it('normalizes rich paid order payloads for side-effect executors', () => {
    expect(
      toRichPaidOrder(
        {
          customer_email: 'jane@example.com',
          discount_amount: '',
          gift_wrapping_fee: null,
          id: 'order-1',
          merchant_id: '',
          order_items: [
            {
              id: 'item-1',
              name: 'iPhone',
              price: '20000',
              product_id: 'product-1',
              quantity: '1',
              variant_name: null,
            },
            { name: 'Case', price: '', quantity: 1, variant_name: null },
            { name: 'Cable', price: 5000, quantity: 'invalid' },
            'invalid',
          ],
          payment_status: 'pending',
          shipping_address: { address: '1 Baci Way', city: 'Lagos' },
          shipping_funding_source: 'customer_checkout',
          shipping_platform_retained_amount: '1250.50',
          shipping_provider: 'GIGL',
          shipping_fee: undefined,
          subtotal: '20000',
          tax_amount: '0',
          tax_basis: 'exclusive',
          total: 20_000,
        },
        { merchantId: 'merchant-1' }
      )
    ).toMatchObject({
      customer_email: 'jane@example.com',
      discount_amount: 0,
      gift_wrapping_fee: 0,
      id: 'order-1',
      merchant_id: 'merchant-1',
      order_items: [
        {
          id: 'item-1',
          name: 'iPhone',
          price: 20_000,
          product_id: 'product-1',
          quantity: 1,
          variant_name: null,
        },
        {
          id: null,
          name: 'Case',
          price: null,
          product_id: null,
          quantity: 1,
          variant_name: null,
        },
        {
          id: null,
          name: 'Cable',
          price: 5000,
          product_id: null,
          quantity: null,
          variant_name: null,
        },
        {
          id: null,
          name: null,
          price: null,
          product_id: null,
          quantity: null,
          variant_name: null,
        },
      ],
      payment_status: 'paid',
      shipping_funding_source: 'customer_checkout',
      shipping_platform_retained_amount: 1250.5,
      shipping_provider: 'GIGL',
      shipping_fee: 0,
      subtotal: 20_000,
      tax_amount: 0,
      total: 20_000,
    });
  });

  it('returns an empty item list for non-array values', () => {
    expect(toRichPaidOrderItems(null)).toEqual([]);
  });

  it('trims optional string fields and normalizes blank values to null', () => {
    expect(
      toRichPaidOrder(
        {
          customer_email: '   ',
          customer_name: ' Jane Doe ',
          id: 'order-1',
          subtotal: 20_000,
          total: 20_000,
        },
        { merchantId: 'merchant-1' }
      )
    ).toMatchObject({
      customer_email: null,
      customer_name: 'Jane Doe',
    });
  });

  it('preserves the checkout shipping economics snapshot for settlement', () => {
    const normalized = toRichPaidOrder(
      {
        id: 'order-1',
        shipping_funding_source: 'merchant_wallet',
        shipping_platform_retained_amount: '0.00',
        shipping_provider: ' GIGL ',
        subtotal: 20_000,
        total: 20_000,
      },
      { merchantId: 'merchant-1' }
    );

    expect(normalized).toMatchObject({
      shipping_funding_source: 'merchant_wallet',
      shipping_platform_retained_amount: 0,
      shipping_provider: 'GIGL',
    });
  });

  it('drops forged shipping funding values instead of treating them as a snapshot', () => {
    expect(
      toRichPaidOrder(
        {
          id: 'order-1',
          shipping_funding_source: 'platform',
          shipping_platform_retained_amount: 'bad',
          shipping_provider: '   ',
          subtotal: 20_000,
          total: 20_000,
        },
        { merchantId: 'merchant-1' }
      )
    ).toMatchObject({
      shipping_funding_source: null,
      shipping_platform_retained_amount: null,
      shipping_provider: null,
    });
  });

  it('throws on invalid required order fields', () => {
    expect(() => toRichPaidOrder(null, { merchantId: 'merchant-1' })).toThrow(
      'Paid order payload is invalid'
    );
    expect(() =>
      toRichPaidOrder(
        { id: '', subtotal: 20_000, total: 20_000 },
        {
          merchantId: 'merchant-1',
        }
      )
    ).toThrow('Paid order is missing id');
    expect(() =>
      toRichPaidOrder(
        { id: 'order-1', subtotal: 'bad', total: 20_000 },
        {
          merchantId: 'merchant-1',
        }
      )
    ).toThrow('Paid order has invalid subtotal');
    expect(() =>
      toRichPaidOrder(
        { id: 'order-1', subtotal: '1e5', total: 20_000 },
        {
          merchantId: 'merchant-1',
        }
      )
    ).toThrow('Paid order has invalid subtotal');
    expect(() =>
      toRichPaidOrder(
        { id: 'order-1', subtotal: ' 20000 ', total: 20_000 },
        {
          merchantId: 'merchant-1',
        }
      )
    ).toThrow('Paid order has invalid subtotal');
    expect(() =>
      toRichPaidOrder(
        {
          discount_amount: '1e3',
          id: 'order-1',
          subtotal: 20_000,
          total: 20_000,
        },
        {
          merchantId: 'merchant-1',
        }
      )
    ).toThrow('Paid order has invalid discount_amount');
  });
});
