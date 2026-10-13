import { describe, expect, it } from 'vitest';
import {
  buildOrderIdempotencyPayload,
  hashOrderIdempotencyPayload,
} from './order-idempotency';
import { selectIdempotencyShippingAddress } from './select-idempotency-shipping-address';

const malformedAddress = {
  address: '2 Olaide Tomori Street, Ikeja, Lagos 100001, Nigeria',
  city: 'Ikeja',
  state: '100001',
};

const repairedAddress = {
  ...malformedAddress,
  state: 'Lagos',
};

const basePayload = {
  merchant_id: '11111111-1111-1111-1111-111111111111',
  customer_email: 'customer@example.com',
  customer_name: 'Test Customer',
  items: [{ product_id: 'p-1', quantity: 1, price: 1000 }],
  shipping_fee: 1500,
  tax_amount: 0,
  shipping_rate_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
};

describe('bugfix: merchant-rate state repair must preserve pre-normalization hashes', () => {
  it('keeps the idempotency hash on the pre-repair state when Lagos is persisted', () => {
    const addressForHash = selectIdempotencyShippingAddress({
      addressBeforeMerchantRateNormalization: malformedAddress,
      normalizedAddress: repairedAddress,
    });

    const preDeployHash = hashOrderIdempotencyPayload(
      buildOrderIdempotencyPayload({
        ...basePayload,
        shipping_address: malformedAddress,
      })
    );
    const retryHash = hashOrderIdempotencyPayload(
      buildOrderIdempotencyPayload({
        ...basePayload,
        shipping_address: addressForHash,
      })
    );
    const normalizedHash = hashOrderIdempotencyPayload(
      buildOrderIdempotencyPayload({
        ...basePayload,
        shipping_address: repairedAddress,
      })
    );

    expect(addressForHash.state).toBe('100001');
    expect(retryHash).toBe(preDeployHash);
    expect(retryHash).not.toBe(normalizedHash);
  });
});
