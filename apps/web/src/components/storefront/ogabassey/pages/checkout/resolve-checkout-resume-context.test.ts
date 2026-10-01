import { describe, expect, it } from 'vitest';
import type { PendingCheckoutOrderSnapshot } from './pending-checkout-order';
import { resolveCheckoutResumeContext } from './resolve-checkout-resume-context';

const pendingOrder: PendingCheckoutOrderSnapshot = {
  orderId: 'order-1',
  merchantId: 'merchant-1',
  customerEmail: ' saved@example.com ',
  customerPhone: '08000000000',
  checkoutFingerprint: 'fingerprint',
  amountDueToGateway: 1000,
  createdAt: '2026-09-27T00:00:00.000Z',
};

describe('resolveCheckoutResumeContext', () => {
  it('resolves query aliases and explicit values before merchant defaults', () => {
    expect(
      resolveCheckoutResumeContext({
        searchParams: new URLSearchParams(
          'orderId=order-2&tracking_token=track-2&token=ignored&email=%20buyer%40example.com%20&merchant_slug=query-store&slug=ignored&gateway=CREDPAL'
        ),
        pendingCheckoutOrder: null,
        merchantId: 'merchant-1',
        merchantSlug: 'current-store',
      })
    ).toEqual({
      resumeOrderId: 'order-2',
      resumeTrackingToken: 'track-2',
      resumeLookupEmail: 'buyer@example.com',
      resumeMerchantSlug: 'query-store',
      preferredGateway: 'credpal',
    });
  });

  it('uses the stored email only for the matching order and merchant', () => {
    const matching = resolveCheckoutResumeContext({
      searchParams: new URLSearchParams('orderId=order-1'),
      pendingCheckoutOrder: pendingOrder,
      merchantId: 'merchant-1',
    });
    const mismatchedMerchant = resolveCheckoutResumeContext({
      searchParams: new URLSearchParams('orderId=order-1'),
      pendingCheckoutOrder: pendingOrder,
      merchantId: 'merchant-2',
    });
    const mismatchedOrder = resolveCheckoutResumeContext({
      searchParams: new URLSearchParams('orderId=order-2'),
      pendingCheckoutOrder: pendingOrder,
      merchantId: 'merchant-1',
    });

    expect(matching.resumeLookupEmail).toBe('saved@example.com');
    expect(mismatchedMerchant.resumeLookupEmail).toBeNull();
    expect(mismatchedOrder.resumeLookupEmail).toBeNull();
  });

  it('accepts the legacy token and slug aliases, but only supported preferred gateways', () => {
    const context = resolveCheckoutResumeContext({
      searchParams: new URLSearchParams(
        'token=legacy&slug=legacy-store&gateway=credit_direct'
      ),
      pendingCheckoutOrder: null,
      merchantSlug: 'current-store',
    });
    const unsupportedGateway = resolveCheckoutResumeContext({
      searchParams: new URLSearchParams('gateway=paystack'),
      pendingCheckoutOrder: null,
    });

    expect(context.resumeTrackingToken).toBe('legacy');
    expect(context.resumeMerchantSlug).toBe('legacy-store');
    expect(context.preferredGateway).toBe('credit_direct');
    expect(unsupportedGateway.preferredGateway).toBeNull();
  });

  it('falls back to the current merchant and permits a pending email before merchant resolution', () => {
    const context = resolveCheckoutResumeContext({
      searchParams: new URLSearchParams('orderId=order-1'),
      pendingCheckoutOrder: pendingOrder,
      merchantSlug: 'current-store',
    });

    expect(context.resumeLookupEmail).toBe('saved@example.com');
    expect(context.resumeMerchantSlug).toBe('current-store');
  });
});
