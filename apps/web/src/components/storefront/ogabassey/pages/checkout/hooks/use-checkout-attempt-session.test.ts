import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import {
  CHECKOUT_PENDING_ORDER_STORAGE_KEY,
  type PendingCheckoutOrderSnapshot,
} from '../pending-checkout-order';
import { useCheckoutAttemptSession } from './use-checkout-attempt-session';

const pendingOrder: PendingCheckoutOrderSnapshot = {
  orderId: 'order-1',
  merchantId: 'merchant-1',
  customerEmail: 'ada@example.test',
  customerPhone: '08000000000',
  checkoutFingerprint: 'fingerprint',
  amountDueToGateway: 10_000,
  createdAt: '2026-10-01T00:00:00.000Z',
};

function options(merchantId = 'merchant-1') {
  return {
    searchParams: new URLSearchParams(
      'orderId=order-1&gateway=credpal&trackingToken=url-token'
    ),
    merchantId,
    merchantSlug: 'store',
    merchantChargeCurrency: 'NGN',
    isHydrated: true,
    form: {
      setCheckoutFields: vi.fn(),
      clearCheckoutSession: vi.fn(),
    },
    navigation: {
      setCurrentStep: vi.fn(),
      setCompletedSteps: vi.fn(),
      routerPush: vi.fn(),
      getHref: (path: string) => path,
    },
    funnel: {
      checkoutCart: [],
      checkoutCartTotal: 0,
      itemSubtotal: 0,
      currencyCode: 'NGN',
    },
  };
}

afterEach(() => {
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

it('uses the matching merchant pending order only as resume email fallback', () => {
  sessionStorage.setItem(
    CHECKOUT_PENDING_ORDER_STORAGE_KEY,
    JSON.stringify(pendingOrder)
  );
  const { result } = renderHook(() => useCheckoutAttemptSession(options()));

  expect(result.current.resumeLookupEmail).toBe('ada@example.test');
  expect(result.current.resumeTrackingToken).toBe('url-token');
  expect(result.current.preferredGateway).toBe('credpal');
  expect(result.current.isOrderInFlightRef.current).toBe(false);
});

it('clears a pending order from another merchant and keeps the synchronous submit lock', async () => {
  sessionStorage.setItem(
    CHECKOUT_PENDING_ORDER_STORAGE_KEY,
    JSON.stringify(pendingOrder)
  );
  const { result } = renderHook(() =>
    useCheckoutAttemptSession(options('merchant-2'))
  );

  await waitFor(() =>
    expect(
      sessionStorage.getItem(CHECKOUT_PENDING_ORDER_STORAGE_KEY)
    ).toBeNull()
  );
  expect(result.current.pendingCheckoutOrder).toBeNull();
  expect(result.current.resumeLookupEmail).toBeNull();
  act(() => {
    expect(result.current.tryBeginSubmission(false)).toBe(true);
    expect(result.current.tryBeginSubmission(false)).toBe(false);
  });
  expect(result.current.isOrderInFlightRef.current).toBe(true);
});
