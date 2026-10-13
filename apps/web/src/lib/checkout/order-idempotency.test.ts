import { describe, expect, it } from 'vitest';
import {
  buildOrderIdempotencyPayload,
  hashOrderIdempotencyPayload,
} from './order-idempotency';

const baseOrder = {
  merchant_id: '11111111-1111-1111-1111-111111111111',
  customer_email: 'ADA@example.com',
  customer_name: 'Ada Buyer',
  customer_phone: '+2348012345678',
  items: [
    {
      product_id: '22222222-2222-2222-2222-222222222222',
      name: 'iPhone 13',
      quantity: 1,
      price: 500000,
      variant_id: '33333333-3333-3333-3333-333333333333',
      variant_attributes: { Color: 'Blue', Storage: '128GB' },
    },
  ],
  shipping_fee: 2500,
  tax_amount: 37687.5,
  gift_wrapping_fee: 0,
  payment_method: 'credit_direct',
  shipping_address: {
    address: '12 Allen Avenue',
    city: 'Ikeja',
    state: 'Lagos',
  },
  selected_quote_id: '44444444-4444-4444-4444-444444444444',
  shipping_provider: 'GIGL',
  use_wallet_credit: false,
  wallet_amount: 0,
  use_savings_credit: false,
} as const;

describe('order idempotency hashing', () => {
  it('hashes equivalent payloads identically after normalization', () => {
    const left = buildOrderIdempotencyPayload(baseOrder);
    const right = buildOrderIdempotencyPayload({
      ...baseOrder,
      customer_email: 'ada@example.com',
      items: [
        {
          ...baseOrder.items[0],
          variant_attributes: { Storage: '128GB', Color: 'Blue' },
        },
      ],
    });

    expect(hashOrderIdempotencyPayload(left)).toBe(
      hashOrderIdempotencyPayload(right)
    );
  });

  it('distinguishes two different discount codes with the same amount', () => {
    const codeA = buildOrderIdempotencyPayload({
      ...baseOrder,
      discount_amount: 0,
      discount_code: 'SAVE10',
    });
    const codeB = buildOrderIdempotencyPayload({
      ...baseOrder,
      discount_amount: 0,
      discount_code: 'WELCOME',
    });

    expect(hashOrderIdempotencyPayload(codeA)).not.toBe(
      hashOrderIdempotencyPayload(codeB)
    );
  });

  it('hashes duplicate product and variant lines identically after line reordering', () => {
    const blueLine = {
      ...baseOrder.items[0],
      price: 500000,
      quantity: 1,
      variant_attributes: { Color: 'Blue', Storage: '128GB' },
    };
    const greenLine = {
      ...baseOrder.items[0],
      price: 505000,
      quantity: 2,
      variant_attributes: { Color: 'Green', Storage: '256GB' },
    };

    const left = buildOrderIdempotencyPayload({
      ...baseOrder,
      items: [blueLine, greenLine],
    });
    const right = buildOrderIdempotencyPayload({
      ...baseOrder,
      items: [greenLine, blueLine],
    });

    expect(hashOrderIdempotencyPayload(left)).toBe(
      hashOrderIdempotencyPayload(right)
    );
  });

  it('changes the hash when the payable checkout payload changes', () => {
    const original = buildOrderIdempotencyPayload(baseOrder);
    const changed = buildOrderIdempotencyPayload({
      ...baseOrder,
      shipping_fee: 5000,
    });

    expect(hashOrderIdempotencyPayload(original)).not.toBe(
      hashOrderIdempotencyPayload(changed)
    );
  });

  it('changes the hash when delivery metadata changes', () => {
    const airportDelivery = buildOrderIdempotencyPayload({
      ...baseOrder,
      delivery_method: 'airport',
      airport_type: 'delivery',
    });
    const airportPickup = buildOrderIdempotencyPayload({
      ...baseOrder,
      delivery_method: 'airport',
      airport_type: 'pickup',
    });
    const doorDelivery = buildOrderIdempotencyPayload({
      ...baseOrder,
      delivery_method: 'door',
      airport_type: undefined,
    });

    expect(hashOrderIdempotencyPayload(airportDelivery)).not.toBe(
      hashOrderIdempotencyPayload(airportPickup)
    );
    expect(hashOrderIdempotencyPayload(airportDelivery)).not.toBe(
      hashOrderIdempotencyPayload(doorDelivery)
    );
  });

  it('changes the hash when an item price changes', () => {
    const original = buildOrderIdempotencyPayload(baseOrder);
    const changed = buildOrderIdempotencyPayload({
      ...baseOrder,
      items: [{ ...baseOrder.items[0], price: 525000 }],
    });

    expect(hashOrderIdempotencyPayload(original)).not.toBe(
      hashOrderIdempotencyPayload(changed)
    );
  });

  it('changes the hash when only an item variant label changes', () => {
    const original = buildOrderIdempotencyPayload({
      ...baseOrder,
      items: [
        {
          ...baseOrder.items[0],
          variant_attributes: undefined,
          variant_id: undefined,
          variant_name: '512GB',
        },
      ],
    });
    const changed = buildOrderIdempotencyPayload({
      ...baseOrder,
      items: [
        {
          ...baseOrder.items[0],
          variant_attributes: undefined,
          variant_id: undefined,
          variant_name: '1TB',
        },
      ],
    });

    expect(hashOrderIdempotencyPayload(original)).not.toBe(
      hashOrderIdempotencyPayload(changed)
    );
  });

  it('hashes equivalent variant label aliases identically', () => {
    const snakeCase = buildOrderIdempotencyPayload({
      ...baseOrder,
      items: [
        {
          ...baseOrder.items[0],
          variant_attributes: undefined,
          variant_id: undefined,
          variant_name: '  Matte   Black ',
        },
      ],
    });
    const camelCase = buildOrderIdempotencyPayload({
      ...baseOrder,
      items: [
        {
          ...baseOrder.items[0],
          variant_attributes: undefined,
          variant_id: undefined,
          variantName: 'matte black',
        },
      ],
    });

    expect(hashOrderIdempotencyPayload(snakeCase)).toBe(
      hashOrderIdempotencyPayload(camelCase)
    );
  });

  it('does not change the hash when the customer switches payment provider', () => {
    const creditDirect = buildOrderIdempotencyPayload({
      ...baseOrder,
      payment_method: 'credit_direct',
    });
    const klumpCard = buildOrderIdempotencyPayload({
      ...baseOrder,
      payment_method: 'card',
    });

    expect(hashOrderIdempotencyPayload(creditDirect)).toBe(
      hashOrderIdempotencyPayload(klumpCard)
    );
  });

  it('keeps the hash byte-identical for orders that carry no shipping_rate_id', () => {
    // Regression guard: adding shipping_rate_id must NOT change the canonical
    // form when the field is absent — carrier-quote, pickup/airport, and mobile
    // storefront checkouts never send it. The digest below was computed from the
    // PRE-change serialization of baseOrder; the field is normalized to
    // `undefined` when empty so JSON.stringify drops the key entirely. If someone
    // later normalizes it to `null` (always present) this hash changes and the
    // test fails, catching the cross-client idempotency-key regression.
    const preChangeDigest =
      'ff55e14d72945d04036c0074a472825400e24521997768e38f953b552c24c447';

    expect(
      hashOrderIdempotencyPayload(buildOrderIdempotencyPayload(baseOrder))
    ).toBe(preChangeDigest);
  });

  it('treats an absent, null, and empty shipping_rate_id identically', () => {
    const absent = buildOrderIdempotencyPayload(baseOrder);
    const explicitNull = buildOrderIdempotencyPayload({
      ...baseOrder,
      shipping_rate_id: null,
    });
    const empty = buildOrderIdempotencyPayload({
      ...baseOrder,
      shipping_rate_id: '   ',
    });

    expect(hashOrderIdempotencyPayload(explicitNull)).toBe(
      hashOrderIdempotencyPayload(absent)
    );
    expect(hashOrderIdempotencyPayload(empty)).toBe(
      hashOrderIdempotencyPayload(absent)
    );
  });

  it('distinguishes two same-priced merchant rates by shipping_rate_id', () => {
    // Two same-fee pickup locations (merchant rates null shipping_provider and
    // selected_quote_id) must not collide on an Idempotency-Key reuse — otherwise
    // the RPC replays the ORIGINAL order instead of returning a conflict.
    const rateA = buildOrderIdempotencyPayload({
      ...baseOrder,
      selected_quote_id: null,
      shipping_provider: null,
      shipping_rate_id: '55555555-5555-4555-8555-555555555555',
    });
    const rateB = buildOrderIdempotencyPayload({
      ...baseOrder,
      selected_quote_id: null,
      shipping_provider: null,
      shipping_rate_id: '66666666-6666-4666-8666-666666666666',
    });

    expect(hashOrderIdempotencyPayload(rateA)).not.toBe(
      hashOrderIdempotencyPayload(rateB)
    );
  });
});
