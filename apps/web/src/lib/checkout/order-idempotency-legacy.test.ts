import { describe, expect, it } from 'vitest';
import {
  buildOrderIdempotencyPayload,
  hashOrderIdempotencyPayload,
} from './order-idempotency';
import { buildLegacyOrderIdempotencyPayload } from './order-idempotency-legacy';

const input = {
  customer_email: 'buyer@example.com',
  customer_name: 'Buyer',
  delivery_method: 'airport',
  airport_type: 'delivery',
  items: [{ price: 1000, quantity: 1 }],
  merchant_id: '11111111-1111-1111-1111-111111111111',
};

describe('buildLegacyOrderIdempotencyPayload', () => {
  it('omits delivery metadata while preserving the canonical legacy payload', () => {
    const legacy = buildLegacyOrderIdempotencyPayload(input);
    const expected = buildOrderIdempotencyPayload({
      ...input,
      delivery_method: undefined,
      airport_type: undefined,
    });

    expect(legacy).toEqual(expected);
    expect(legacy.delivery_method).toBeUndefined();
    expect(legacy.airport_type).toBeUndefined();
  });

  it('recreates the pre-metadata hash for legacy order replays', () => {
    const legacyDoor = buildLegacyOrderIdempotencyPayload({
      ...input,
      delivery_method: 'door',
      airport_type: undefined,
    });
    const legacyAirport = buildLegacyOrderIdempotencyPayload({
      ...input,
      delivery_method: 'airport',
      airport_type: 'delivery',
    });
    const preMetadataPayload = buildOrderIdempotencyPayload({
      ...input,
      delivery_method: undefined,
      airport_type: undefined,
    });

    expect(hashOrderIdempotencyPayload(legacyDoor)).toBe(
      hashOrderIdempotencyPayload(preMetadataPayload)
    );
    expect(hashOrderIdempotencyPayload(legacyAirport)).toBe(
      hashOrderIdempotencyPayload(preMetadataPayload)
    );
  });

  it('forwards item-sort options to the shared builder', () => {
    const legacy = buildLegacyOrderIdempotencyPayload(input, {
      itemSort: 'locale',
    });
    const expected = buildOrderIdempotencyPayload(
      {
        ...input,
        delivery_method: undefined,
        airport_type: undefined,
      },
      { itemSort: 'locale' }
    );

    expect(legacy).toEqual(expected);
  });
});
