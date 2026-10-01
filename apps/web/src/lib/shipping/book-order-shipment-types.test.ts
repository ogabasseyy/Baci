import { describe, expect, expectTypeOf, it } from 'vitest';
import type { InternationalShipmentOrderItem } from '@/lib/shipping/international-shipment-items';
import type { BookOrderRecord } from './book-order-shipment-types';

describe('BookOrderRecord', () => {
  it('accepts merchant-wallet economics alongside customer-checkout orders', () => {
    const walletOrder: BookOrderRecord = {
      id: 'order-1',
      customer_name: 'Jane Doe',
      customer_email: 'jane@example.com',
      customer_phone: '08012345678',
      shipping_fee: 4500,
      selected_quote_id: 'quote-1',
      shipping_provider: 'GIGL',
      shipping_funding_source: 'merchant_wallet',
      shipping_provider_cost: '10000',
      shipping_platform_margin: 2000,
      shipping_pricing_version: 'gigl_platform_margin_v1',
      shipping_address: {
        address: '123 Main St',
        city: 'Lagos',
        country: 'Nigeria',
        countryCode: 'NG',
        postalCode: '100001',
        state: 'Lagos',
        phone: '08012345678',
      },
      order_items: [
        {
          name: 'Widget',
          quantity: 1,
          price: 5000,
        } satisfies InternationalShipmentOrderItem,
      ],
    };
    const checkoutOrder: BookOrderRecord = {
      id: 'order-2',
      customer_name: null,
      customer_email: null,
      customer_phone: null,
      shipping_fee: null,
      selected_quote_id: null,
      shipping_provider: null,
      shipping_funding_source: 'customer_checkout',
      shipping_address: null,
      order_items: null,
    };

    expect(walletOrder.shipping_funding_source).toBe('merchant_wallet');
    expect(checkoutOrder.shipping_funding_source).toBe('customer_checkout');
    expect(walletOrder.shipping_provider_cost).toBe('10000');
  });

  it('limits funding source to checkout, wallet, or null', () => {
    expectTypeOf<BookOrderRecord['shipping_funding_source']>().toEqualTypeOf<
      'customer_checkout' | 'merchant_wallet' | null | undefined
    >();
    expectTypeOf<'paypal'>().not.toMatchTypeOf<
      BookOrderRecord['shipping_funding_source']
    >();
  });
});
