import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { captureCheckoutFunnelEventOnce } from '@/lib/posthog/capture-checkout-funnel-event';
import {
  CHECKOUT_PENDING_ORDER_STORAGE_KEY,
  type PendingCheckoutOrderSnapshot,
} from '../pending-checkout-order';
import { useCheckoutAttemptSession } from './use-checkout-attempt-session';

vi.mock('@/lib/posthog/capture-checkout-funnel-event', () => ({
  captureCheckoutFunnelEventOnce: vi.fn(),
}));

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
  vi.clearAllMocks();
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

it('gates resumed lookup on hydration, uses stamped display amounts, and stops funnel repeats after order creation', async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        id: 'order-1',
        short_id: 'BACI-1',
        subtotal: 10_000,
        shipping_cost: 1_500,
        tax_amount: 750,
        total: 12_250,
        currency: 'usd',
        customer_name: 'Ada Okon',
        customer_email: 'ada@example.test',
        customer_phone: '08000000000',
        items: [
          {
            id: 'line-1',
            product_id: 'item-1',
            product_name: 'Stamped item',
            quantity: 2,
            price: 5_000,
          },
        ],
      })
    )
  );
  vi.stubGlobal('fetch', fetchMock);
  const initialOptions = {
    ...options(),
    isHydrated: false,
    searchParams: new URLSearchParams(
      'orderId=order-1&trackingToken=resume-token'
    ),
  };
  const { result, rerender } = renderHook(
    (props) => useCheckoutAttemptSession(props),
    { initialProps: initialOptions }
  );

  expect(fetchMock).not.toHaveBeenCalled();
  expect(captureCheckoutFunnelEventOnce).not.toHaveBeenCalled();

  rerender({ ...initialOptions, isHydrated: true });
  await waitFor(() =>
    expect(result.current.displayModel.summaryOrder?.id).toBe('order-1')
  );
  expect(result.current.displayModel).toMatchObject({
    effectiveCheckoutCartTotal: 12_250,
    effectiveItemSubtotal: 10_000,
    summarySubtotal: 10_000,
    hasCheckoutCartItems: false,
    displayItems: [
      expect.objectContaining({
        kind: 'resumed',
        id: 'line-1',
        product_id: 'item-1',
        product_name: 'Stamped item',
        price: 5_000,
        quantity: 2,
      }),
    ],
  });
  expect(captureCheckoutFunnelEventOnce).toHaveBeenCalledWith(
    'checkout_started',
    expect.any(String),
    expect.objectContaining({
      currency: 'USD',
      subtotal: 10_000,
      total: 12_250,
    })
  );
  expect(captureCheckoutFunnelEventOnce).toHaveBeenCalledOnce();

  act(() => {
    result.current.setCheckoutOrderCreated(true);
    result.current.setPendingCheckoutOrder(pendingOrder);
  });
  expect(result.current.checkoutOrderCreated).toBe(true);
  expect(captureCheckoutFunnelEventOnce).toHaveBeenCalledOnce();
});
