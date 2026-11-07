import { describe, expect, it } from 'vitest';
import { buildSharedCartShippingRateMarker } from './build-shared-cart-shipping-rate-marker';

const sharedCart = {
  cart_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  checkout_session_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  checkout_generation: 2,
  cart_version: 7,
};

describe('buildSharedCartShippingRateMarker', () => {
  it('adds the explicit nullable marker for an enabled shared cart', () => {
    expect(
      buildSharedCartShippingRateMarker({
        enabled: true,
        sharedCart,
        shippingRateId: null,
      })
    ).toEqual({ p_shipping_rate_id: null });
  });

  it('preserves a selected rate id', () => {
    expect(
      buildSharedCartShippingRateMarker({
        enabled: true,
        sharedCart,
        shippingRateId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      })
    ).toEqual({
      p_shipping_rate_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    });
  });

  it.each([
    ['disabled feature', { enabled: false, sharedCart }],
    ['missing shared cart', { enabled: true, sharedCart: undefined }],
  ])('returns null for %s', (_label, input) => {
    expect(
      buildSharedCartShippingRateMarker({
        ...input,
        shippingRateId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      })
    ).toBeNull();
  });
});
