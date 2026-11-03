import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { bumpCartSessionGeneration } from '@/hooks/cart/shared-cart-storage';
import { useCheckoutPaymentSession } from './use-checkout-payment-session';

const ready = {
  orderId: '11111111-1111-4111-8111-111111111111',
  orderNumber: 'UBA-1',
  trackingToken: 'tracking-proof',
  customerEmail: 'ada@example.test',
  customerName: 'Ada Test',
  customerPhone: '+2348031234567',
  checkoutFingerprint:
    'uba_redvault:{"merchantId":"merchant-1","customerEmail":"ada@example.test","items":[{"product_id":"fixture"}]}',
  billingAddress: {
    line1: 'Pickup at Store',
    city: 'Lagos',
    state: 'Lagos',
    country: 'NG',
  },
  currency: 'NGN',
  total: 102.5,
};
const summary = {
  productSubtotalKobo: 10_000,
  eligibleSubtotalKobo: 10_000,
  ineligibleSubtotalKobo: 0,
  discountKobo: 500,
  assuranceFeeKobo: 0,
  taxKobo: 750,
  shippingKobo: 0,
  giftWrappingKobo: 0,
  payableKobo: 10_250,
  mixedBasket: false,
};
const pending = {
  paymentMethod: 'uba_redvault',
  orderId: ready.orderId,
  orderNumber: ready.orderNumber,
  trackingToken: ready.trackingToken,
  merchantId: 'merchant-1',
  customerEmail: ready.customerEmail,
  customerPhone: ready.customerPhone,
  checkoutFingerprint: ready.checkoutFingerprint,
  amountDueToGateway: 102.5,
  createdAt: '2026-10-29T00:00:00.000Z',
  redvaultReview: { ready, summary },
};

function options(overrides: Record<string, unknown> = {}) {
  return {
    baseTotal: 0,
    clearPendingCheckoutOrder: vi.fn(),
    currencyCode: 'NGN',
    discountSubtotal: 0,
    hasAuthenticatedUser: false,
    hasCheckoutCartItems: false,
    isOrderInFlightRef: { current: false },
    merchantId: 'merchant-1',
    merchantSlug: 'ogabassey',
    pendingCheckoutOrder: pending,
    recoverCart: true,
    resumeOrderId: null,
    preferredGateway: null,
    resumedOrder: null,
    ...overrides,
  };
}

describe('shared-cart REDVAULT review recovery', () => {
  it('restores the prepared review after a refresh without initializing payment', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { result } = renderHook(() =>
      useCheckoutPaymentSession(options() as never)
    );
    await waitFor(() => expect(result.current.method).toBe('uba_redvault'));
    expect(result.current.redvault.orderReady).toEqual(ready);
    expect(result.current.redvault.summary).toEqual(summary);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('hides a restored review when another tab retires its cart authority', async () => {
    const epochKey = 'baci-cart-authority-epoch:ogabassey';
    localStorage.setItem(epochKey, 'epoch-one');
    const fenced = {
      ...pending,
      redvaultReview: {
        ready,
        summary,
        recoveryFence: { merchantSlug: 'ogabassey', epoch: 'epoch-one' },
      },
    };
    const { result } = renderHook(() =>
      useCheckoutPaymentSession(
        options({ pendingCheckoutOrder: fenced }) as never
      )
    );
    await waitFor(() =>
      expect(result.current.redvault.orderReady).not.toBeNull()
    );
    act(() => {
      localStorage.setItem(epochKey, 'epoch-two');
      bumpCartSessionGeneration({ merchantSlug: 'ogabassey' });
    });
    expect(result.current.redvault.orderReady).toBeNull();
    expect(result.current.redvault.summary).toBeNull();
    localStorage.removeItem(epochKey);
  });

  it('hides an already prepared review if the authority changed before its fence mounted', () => {
    const epochKey = 'baci-cart-authority-epoch:ogabassey';
    localStorage.setItem(epochKey, 'epoch-two');
    let current = options({ pendingCheckoutOrder: null });
    const { result, rerender } = renderHook(() =>
      useCheckoutPaymentSession(current as never)
    );
    act(() => result.current.redvault.setOrderReady(ready));
    current = options({
      pendingCheckoutOrder: {
        ...pending,
        redvaultReview: {
          ready,
          summary,
          recoveryFence: { merchantSlug: 'ogabassey', epoch: 'epoch-one' },
        },
      },
    });
    rerender();
    expect(result.current.redvault.orderReady).toBeNull();
    localStorage.removeItem(epochKey);
  });

  it.each([
    { merchantId: 'other-merchant' },
    { recoverCart: false },
    { hasCheckoutCartItems: true },
    { resumeOrderId: 'other-order' },
    {
      pendingCheckoutOrder: {
        ...pending,
        redvaultReview: { ready: { ...ready, orderId: 'different' }, summary },
      },
    },
    {
      pendingCheckoutOrder: {
        ...pending,
        redvaultReview: { ready, summary: { ...summary, payableKobo: 1 } },
      },
    },
  ])('does not restore a review for an ineligible or inconsistent context: %j', (override) => {
    const { result } = renderHook(() =>
      useCheckoutPaymentSession(options(override) as never)
    );
    expect(result.current.method).toBe('');
    expect(result.current.redvault.orderReady).toBeNull();
  });
});
