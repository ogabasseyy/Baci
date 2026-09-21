import { describe, expect, it } from '@jest/globals';
import { buildOrderPayload } from '@/services/orders.payload';
import { CreateOrderRequestSchema } from '@/services/orders.schemas';
import {
  buildCheckoutOrderRequest,
  createCheckoutSnapshot,
} from './checkout-order-builders';

const address = {
  email: 'ada@example.com',
  firstName: 'Ada',
  lastName: 'Lovelace',
  phone: '08012345678',
  address: '1 Test Street',
  city: 'Lagos',
  state: 'Lagos',
};

describe('checkout order builders', () => {
  it('uses negotiated line prices but leaves expected_total to the API tax boundary', () => {
    const itemsSnapshot = [
      {
        id: 'line-1',
        product_id: 'product-1',
        slug: 'macbook-air-m1',
        name: 'MacBook Air M1',
        price: 690000,
        negotiatedPrice: 676200,
        negotiationStatus: 'accepted' as const,
        quantity: 1,
      },
    ];
    const snapshot = createCheckoutSnapshot(itemsSnapshot, 0, 50715);

    const request = buildCheckoutOrderRequest({
      address,
      customerEmail: 'ada@example.com',
      customerName: 'Ada Lovelace',
      customerPhone: '08012345678',
      deliveryMethod: 'door',
      itemsSnapshot,
      paymentMethodForOrder: 'credit_direct',
      selectedQuote: undefined,
      shippingProvider: undefined,
      snapshot,
    });

    expect(request.items[0].price).toBe(676200);
    expect(request.subtotal).toBe(676200);
    expect(request.tax_amount).toBe(50715);
    // Mobile submits line prices only; the web API derives the payable total
    // server-side so tax/payment integrity never depends on client totals.
    expect(request.expected_total).toBeUndefined();
    expect(request.client_total).toBeUndefined();
  });

  it('ignores stale negotiated prices for best-price items when building orders', () => {
    const itemsSnapshot = [
      {
        id: 'line-1',
        product_id: 'product-1',
        slug: 'tecno-spark-50',
        brand: 'Tecno',
        name: 'Tecno Spark 50',
        price: 150000,
        negotiatedPrice: 147000,
        negotiationStatus: 'accepted' as const,
        quantity: 1,
        hasAssurance: true,
      },
    ];
    const snapshot = createCheckoutSnapshot(itemsSnapshot, 0, 11250);

    const request = buildCheckoutOrderRequest({
      address,
      customerEmail: 'ada@example.com',
      customerName: 'Ada Lovelace',
      customerPhone: '08012345678',
      deliveryMethod: 'door',
      itemsSnapshot,
      paymentMethodForOrder: 'paystack',
      selectedQuote: undefined,
      shippingProvider: undefined,
      snapshot,
    });

    expect(request.items[0].price).toBe(150000);
    expect(request.items[0].assurance_fee).toBe(7500);
    expect(request.subtotal).toBe(150000);
    expect(request.expected_total).toBeUndefined();
    expect(request.client_total).toBeUndefined();
  });

  it('preserves selected condition and variant labels in order items', () => {
    const itemsSnapshot = [
      {
        id: 'line-1',
        product_id: 'product-1',
        slug: 'macbook-air-m2',
        name: '13" MacBook Air M2 (2022)',
        price: 690000,
        quantity: 1,
        condition: 'Open Box',
        variant_id: 'variant-open-box-512',
        variant_name: '512GB',
        variant_attributes: {
          storage: '512GB',
        },
      },
    ];
    const snapshot = createCheckoutSnapshot(itemsSnapshot, 0, 0);

    const request = buildCheckoutOrderRequest({
      address,
      customerEmail: 'ada@example.com',
      customerName: 'Ada Lovelace',
      customerPhone: '08012345678',
      deliveryMethod: 'door',
      itemsSnapshot,
      paymentMethodForOrder: 'paystack',
      selectedQuote: undefined,
      shippingProvider: undefined,
      snapshot,
    });

    expect(request.items[0]).toEqual(
      expect.objectContaining({
        condition: 'Open Box',
        variant_id: 'variant-open-box-512',
        variant_name: '512GB',
        variant_attributes: {
          storage: '512GB',
        },
      })
    );
  });

  it('preserves expected_total through validation and payload serialization', () => {
    const parsed = CreateOrderRequestSchema.parse({
      customer_email: 'ada@example.com',
      customer_name: 'Ada Lovelace',
      customer_phone: '08012345678',
      items: [
        { id: 'product-1', name: 'MacBook Air M1', quantity: 1, price: 676200 },
      ],
      subtotal: 676200,
      shipping_fee: 0,
      tax_amount: 50715,
      expected_total: 726915,
      client_total: 726915,
      payment_method: 'credit_direct',
      shipping_address: address,
    });

    const payload = buildOrderPayload({
      merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
      request: parsed,
    });

    expect(payload.expected_total).toBe(726915);
    expect(payload.client_total).toBe(726915);
  });

  it('keeps a selected GIGL station-pickup quote on pickup station orders', () => {
    const request = buildCheckoutOrderRequest({
      address: { ...address, city: 'Port Harcourt', state: 'Rivers' },
      customerEmail: 'ada@example.com',
      customerName: 'Ada Lovelace',
      customerPhone: '08012345678',
      deliveryMethod: 'pickup_station',
      itemsSnapshot: [
        {
          id: 'line-1',
          product_id: 'product-1',
          slug: 'iphone-13',
          name: 'iPhone 13',
          price: 500000,
          quantity: 1,
        },
      ],
      paymentMethodForOrder: 'paystack',
      selectedQuote: {
        id: '5ec1bd0e-7838-4379-a9e6-d47167f1d0c9',
        displayName: 'GIG Logistics - Pickup at PORT HARCOURT',
        isStationPickup: true,
        price: 9493,
        provider: 'GIGL',
        stationAddress: 'GIGL Aba Road, Port Harcourt',
        stationName: 'PORT HARCOURT',
      },
      shippingProvider: 'GIGL',
      snapshot: createCheckoutSnapshot(
        [
          {
            id: 'line-1',
            product_id: 'product-1',
            slug: 'iphone-13',
            name: 'iPhone 13',
            price: 500000,
            quantity: 1,
          },
        ],
        9493,
        0
      ),
    });

    expect(request.selected_quote_id).toBe(
      '5ec1bd0e-7838-4379-a9e6-d47167f1d0c9'
    );
    expect(request.shipping_provider).toBe('GIGL');
    expect(request.shipping_fee).toBe(9493);
    expect(request.shipping_address.address).toBe(
      'PORT HARCOURT, GIGL Aba Road, Port Harcourt'
    );
    expect(request.shipping_address.city).toBe('Port Harcourt');
    expect(request.shipping_address.state).toBe('Rivers');
  });

  it('serializes merchant delivery rates without a carrier quote id', () => {
    const rateId = '5ec1bd0e-7838-4379-a9e6-d47167f1d0c9';
    const itemsSnapshot = [
      {
        id: 'line-1',
        product_id: 'product-1',
        slug: 'iphone-13',
        name: 'iPhone 13',
        price: 500000,
        quantity: 1,
      },
    ];

    const request = buildCheckoutOrderRequest({
      address,
      customerEmail: 'ada@example.com',
      customerName: 'Ada Lovelace',
      customerPhone: '08012345678',
      deliveryMethod: 'door',
      itemsSnapshot,
      paymentMethodForOrder: 'paystack',
      selectedQuote: {
        id: `mrate_${rateId}`,
        displayName: 'Lagos delivery',
        price: 1500,
        provider: 'MERCHANT',
      },
      shippingProvider: 'MERCHANT',
      snapshot: createCheckoutSnapshot(itemsSnapshot, 1500, 0),
    });

    expect(request.selected_quote_id).toBeUndefined();
    expect(request.shipping_provider).toBeUndefined();
    expect(request.shipping_rate_id).toBe(rateId);

    const payload = buildOrderPayload({
      merchantId: 'merchant-1',
      request: CreateOrderRequestSchema.parse(request),
    });
    expect(payload).toMatchObject({
      selected_quote_id: null,
      shipping_provider: null,
      shipping_rate_id: rateId,
    });
  });

  it('serializes UUIDv7 merchant delivery rates through order validation', () => {
    const rateId = '018f3f20-2d7a-7cc0-8c4f-3c82a742d8c4';
    const itemsSnapshot = [
      {
        id: 'line-1',
        product_id: 'product-1',
        slug: 'iphone-13',
        name: 'iPhone 13',
        price: 500000,
        quantity: 1,
      },
    ];

    const request = buildCheckoutOrderRequest({
      address,
      customerEmail: 'ada@example.com',
      customerName: 'Ada Lovelace',
      customerPhone: '08012345678',
      deliveryMethod: 'door',
      itemsSnapshot,
      paymentMethodForOrder: 'paystack',
      selectedQuote: {
        id: `mrate_${rateId}`,
        displayName: 'Lagos delivery',
        price: 1500,
        provider: 'MERCHANT',
      },
      shippingProvider: 'MERCHANT',
      snapshot: createCheckoutSnapshot(itemsSnapshot, 1500, 0),
    });

    expect(request).toMatchObject({
      selected_quote_id: undefined,
      shipping_provider: undefined,
      shipping_rate_id: rateId,
    });

    const payload = buildOrderPayload({
      merchantId: 'merchant-1',
      request: CreateOrderRequestSchema.parse(request),
    });
    expect(payload).toMatchObject({
      selected_quote_id: null,
      shipping_provider: null,
      shipping_rate_id: rateId,
    });
  });

  it.each([
    'mrate_not-a-uuid',
    'merchant-rate-without-prefix',
  ])('does not serialize malformed merchant rate %s as a carrier quote', (quoteId) => {
    const itemsSnapshot = [
      {
        id: 'line-1',
        product_id: 'product-1',
        slug: 'iphone-13',
        name: 'iPhone 13',
        price: 500000,
        quantity: 1,
      },
    ];
    const request = buildCheckoutOrderRequest({
      address,
      customerEmail: 'ada@example.com',
      customerName: 'Ada Lovelace',
      customerPhone: '08012345678',
      deliveryMethod: 'door',
      itemsSnapshot,
      paymentMethodForOrder: 'paystack',
      selectedQuote: {
        id: quoteId,
        displayName: 'Lagos delivery',
        price: 1500,
        provider: 'MERCHANT',
      },
      shippingProvider: 'MERCHANT',
      snapshot: createCheckoutSnapshot(itemsSnapshot, 1500, 0),
    });

    expect(request.selected_quote_id).toBeUndefined();
    expect(request.shipping_provider).toBeUndefined();
    expect(request.shipping_rate_id).toBeUndefined();

    const payload = buildOrderPayload({
      merchantId: 'merchant-1',
      request: CreateOrderRequestSchema.parse(request),
    });
    expect(payload).toMatchObject({
      selected_quote_id: null,
      shipping_provider: null,
      shipping_rate_id: null,
    });
  });

  it('does not serialize a stale station-pickup quote on door orders', () => {
    const request = buildCheckoutOrderRequest({
      address,
      customerEmail: 'ada@example.com',
      customerName: 'Ada Lovelace',
      customerPhone: '08012345678',
      deliveryMethod: 'door',
      itemsSnapshot: [
        {
          id: 'line-1',
          product_id: 'product-1',
          slug: 'iphone-13',
          name: 'iPhone 13',
          price: 500000,
          quantity: 1,
        },
      ],
      paymentMethodForOrder: 'paystack',
      selectedQuote: {
        id: 'station-quote',
        displayName: 'GIG Logistics - Pickup at PORT HARCOURT',
        isStationPickup: true,
        price: 9493,
        provider: 'GIGL',
      },
      shippingProvider: undefined,
      snapshot: createCheckoutSnapshot(
        [
          {
            id: 'line-1',
            product_id: 'product-1',
            slug: 'iphone-13',
            name: 'iPhone 13',
            price: 500000,
            quantity: 1,
          },
        ],
        0,
        0
      ),
    });

    expect(request.selected_quote_id).toBeUndefined();
    expect(request.shipping_address.address).toBe(address.address);
  });

  it('uses the merchant pickup address when no provider station quote is selected', () => {
    const request = buildCheckoutOrderRequest({
      address,
      customerEmail: 'ada@example.com',
      customerName: 'Ada Lovelace',
      customerPhone: '08012345678',
      deliveryMethod: 'pickup_station',
      itemsSnapshot: [
        {
          id: 'line-1',
          product_id: 'product-1',
          slug: 'iphone-13',
          name: 'iPhone 13',
          price: 500000,
          quantity: 1,
        },
      ],
      paymentMethodForOrder: 'paystack',
      selectedQuote: undefined,
      shippingProvider: undefined,
      snapshot: createCheckoutSnapshot(
        [
          {
            id: 'line-1',
            product_id: 'product-1',
            slug: 'iphone-13',
            name: 'iPhone 13',
            price: 500000,
            quantity: 1,
          },
        ],
        0,
        0
      ),
    });

    expect(request.selected_quote_id).toBeUndefined();
    expect(request.shipping_provider).toBeUndefined();
    expect(request.shipping_address).toEqual(address);
  });

  it('forwards quiz voucher fields end-to-end from the cart line to the API payload', () => {
    // Regression: mapCartItemsToOrderItems dropped condition/voucher_token/
    // voucher_award_id, silently breaking mobile prize redemption at checkout
    // even though the downstream payload builder forwards them.
    const voucherToken = `qv1.${'A'.repeat(220)}.${'B'.repeat(43)}`;
    const itemsSnapshot = [
      {
        id: 'line-prize',
        product_id: 'prod-prize',
        slug: 'iphone-15',
        name: 'iPhone 15 (Quiz Prize)',
        price: 0,
        quantity: 1,
        condition: 'new',
        voucher_token: voucherToken,
        voucher_award_id: '11111111-1111-4111-8111-111111111111',
      },
    ];
    const snapshot = createCheckoutSnapshot(itemsSnapshot, 0, 0);

    const request = buildCheckoutOrderRequest({
      address,
      customerEmail: 'ada@example.com',
      customerName: 'Ada Lovelace',
      customerPhone: '08012345678',
      deliveryMethod: 'door',
      itemsSnapshot,
      paymentMethodForOrder: 'card',
      selectedQuote: undefined,
      shippingProvider: undefined,
      snapshot,
    });

    // Mapper must carry the voucher identity + raw condition enum.
    expect(request.items[0].condition).toBe('new');
    expect(request.items[0].voucher_token).toBe(voucherToken);
    expect(request.items[0].voucher_award_id).toBe(
      '11111111-1111-4111-8111-111111111111'
    );
    expect(request.items[0].price).toBe(0);

    // And the full chain: request validates + the API payload forwards them.
    const parsed = CreateOrderRequestSchema.parse(request);
    const payload = buildOrderPayload({
      merchantId: 'merchant-1',
      request: parsed,
    });
    expect(payload.items[0].voucher_token).toBe(voucherToken);
    expect(payload.items[0].voucher_award_id).toBe(
      '11111111-1111-4111-8111-111111111111'
    );
    expect(payload.items[0].condition).toBe('new');
  });
});
