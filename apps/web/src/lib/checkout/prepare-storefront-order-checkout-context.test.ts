import { describe, expect, it } from 'vitest';
import { prepareStorefrontOrderCheckoutContext } from './prepare-storefront-order-checkout-context';

const sharedCart = {
  cart_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  checkout_session_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  checkout_generation: 3,
  cart_version: 8,
};

const validInput = {
  featureEnabled: true,
  sharedCart,
  principalId: 'guest:cart-principal-123',
  idempotencyKey: 'checkout-request-123456',
  checkoutRequestHash: 'a'.repeat(64),
  checkoutVariant: 'base' as const,
  hasQuizVoucherItem: false,
  replaySignals: [] as boolean[],
  isMerchantRateOrder: true,
  shippingRateId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  shippingConfigRevision: '42',
  canonicalSubtotal: 154.9,
  shippingFee: 12.5,
  fulfillmentKind: 'ship' as const,
  addressCountry: null,
  addressState: 'Lagos',
  merchantCountry: 'NG',
};

describe('prepareStorefrontOrderCheckoutContext', () => {
  it('keeps the feature-off path free of claims and marker arguments', () => {
    expect(
      prepareStorefrontOrderCheckoutContext({
        ...validInput,
        featureEnabled: false,
      })
    ).toEqual({
      ok: true,
      enabled: false,
      checkoutBinding: null,
      merchantRateAttestation: null,
      shippingRateMarker: null,
    });
  });

  it('binds a fresh merchant-rate checkout to the verified shipping basis', () => {
    expect(prepareStorefrontOrderCheckoutContext(validInput)).toMatchObject({
      ok: true,
      enabled: true,
      checkoutBinding: {
        deliveryMode: 'merchant_rate',
        checkoutVariant: 'base',
        cartId: sharedCart.cart_id,
        checkoutSessionId: sharedCart.checkout_session_id,
      },
      merchantRateAttestation: {
        shippingRateId: validInput.shippingRateId,
        shippingConfigRevision: '42',
        canonicalSubtotalMinor: 15490,
        shippingFeeMinor: 1250,
        fulfillmentKind: 'ship',
      },
      shippingRateMarker: { p_shipping_rate_id: validInput.shippingRateId },
    });
  });

  it('keeps confirmed replay identity and does not mint fresh rate attestation', () => {
    expect(
      prepareStorefrontOrderCheckoutContext({
        ...validInput,
        replaySignals: [false, true],
      })
    ).toMatchObject({
      ok: true,
      checkoutBinding: { deliveryMode: 'replay' },
      merchantRateAttestation: null,
      shippingRateMarker: { p_shipping_rate_id: validInput.shippingRateId },
    });
  });

  it('marks a shared-cart non-rate checkout explicitly with a null shipping rate', () => {
    expect(
      prepareStorefrontOrderCheckoutContext({
        ...validInput,
        isMerchantRateOrder: false,
        shippingRateId: null,
        shippingConfigRevision: undefined,
        canonicalSubtotal: null,
      })
    ).toMatchObject({
      ok: true,
      checkoutBinding: { deliveryMode: 'no_merchant_rate' },
      merchantRateAttestation: null,
      shippingRateMarker: { p_shipping_rate_id: null },
    });
  });

  it('maps missing verified rate context to the route 409 response shape', () => {
    expect(
      prepareStorefrontOrderCheckoutContext({
        ...validInput,
        shippingConfigRevision: undefined,
      })
    ).toEqual({
      ok: false,
      enabled: true,
      status: 409,
      response: {
        code: 'SHIPPING_RATE_BINDING_UNAVAILABLE',
        error: 'Unable to bind this checkout to its verified shipping details',
      },
      reason: 'Shipping configuration revision is unavailable',
    });
  });

  it('preserves REDVAULT variant and verified voucher identity handling', () => {
    const redvault = prepareStorefrontOrderCheckoutContext({
      ...validInput,
      checkoutVariant: 'redvault',
    });
    expect(redvault).toMatchObject({
      ok: true,
      checkoutBinding: { checkoutVariant: 'redvault' },
    });

    const voucher = prepareStorefrontOrderCheckoutContext({
      ...validInput,
      checkoutVariant: 'quiz_voucher',
      hasQuizVoucherItem: true,
      voucherAwardId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      idempotencyKey: null,
      checkoutRequestHash: null,
      isMerchantRateOrder: false,
      shippingRateId: null,
      shippingConfigRevision: undefined,
      canonicalSubtotal: null,
    });
    expect(voucher).toMatchObject({
      ok: true,
      checkoutBinding: {
        identityKind: 'quiz_voucher',
        checkoutVariant: 'quiz_voucher',
        voucherAwardId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      },
    });
  });

  it('maps unsupported voucher replay to a fail-closed route response', () => {
    expect(
      prepareStorefrontOrderCheckoutContext({
        ...validInput,
        checkoutVariant: 'quiz_voucher',
        hasQuizVoucherItem: true,
        voucherAwardId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        replaySignals: [true],
      })
    ).toMatchObject({
      ok: false,
      status: 409,
      response: { code: 'SHIPPING_RATE_BINDING_UNAVAILABLE' },
      reason: 'Quiz voucher replay binding is unsupported',
    });
  });
});
