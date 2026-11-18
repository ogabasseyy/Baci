// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useCheckoutAttemptSession } from './use-checkout-attempt-session';

const { mockUseBeginCheckoutTracking } = vi.hoisted(() => ({
  mockUseBeginCheckoutTracking: vi.fn(),
}));

vi.mock('./use-begin-checkout-tracking', () => ({
  useBeginCheckoutTracking: mockUseBeginCheckoutTracking,
}));
vi.mock('@/lib/posthog/capture-checkout-funnel-event', () => ({
  captureCheckoutFunnelEventOnce: vi.fn(),
}));

it('reports begin_checkout for the storefront checkout cart (regression: never reported)', () => {
  const checkoutCart = [
    {
      id: 'prod-1',
      cartItemId: 'line-1',
      name: 'Phone',
      price: 100,
      quantity: 1,
    },
  ] as never[];

  renderHook(() =>
    useCheckoutAttemptSession({
      searchParams: new URLSearchParams(),
      merchantId: 'merchant-1',
      merchantSlug: 'ogabassey',
      merchantChargeCurrency: 'NGN',
      isHydrated: true,
      form: { setCheckoutFields: vi.fn(), clearCheckoutSession: vi.fn() },
      navigation: {
        setCurrentStep: vi.fn(),
        setCompletedSteps: vi.fn(),
        routerPush: vi.fn(),
        getHref: (path: string) => path,
      },
      funnel: {
        checkoutCart,
        checkoutCartTotal: 100,
        itemSubtotal: 100,
        currencyCode: 'NGN',
      },
    })
  );

  expect(mockUseBeginCheckoutTracking).toHaveBeenCalledWith(
    expect.objectContaining({
      checkoutCart,
      currency: 'NGN',
      isHydrated: true,
      merchantId: 'merchant-1',
      attemptId: expect.stringMatching(/^gen-/),
    })
  );
});
