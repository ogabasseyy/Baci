import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { captureCheckoutFunnelEventOnce } from '@/lib/posthog/capture-checkout-funnel-event';
import { useResumedCheckoutStartFunnel } from './use-resumed-checkout-start-funnel';

vi.mock('@/lib/posthog/capture-checkout-funnel-event', () => ({
  captureCheckoutFunnelEventOnce: vi.fn(),
}));

const resumedOrder = {
  id: 'order-1',
  short_id: 'ABC123',
  subtotal: 10000,
  shipping_cost: 1500,
  total: 12000,
  currency: 'USD',
  customer_name: 'Ada Buyer',
  customer_email: 'ada@example.com',
  customer_phone: '+2348123456789',
  shipping_address: {
    address: '1 Marina',
    city: 'Lagos',
    state: 'Lagos',
    phone: '+2348123456789',
  },
  items: [],
};

const resumedItems = [{ id: 'line-1', kind: 'resumed' as const, quantity: 1 }];

function baseParams(overrides: Record<string, unknown> = {}) {
  return {
    attemptId: 'gen-1',
    checkoutCartTotal: 9000,
    currencyCode: 'NGN',
    displayItems: resumedItems,
    effectiveItemSubtotal: 10000,
    hasCheckoutCartItems: false,
    isHydrated: true,
    merchantId: 'merchant-1',
    resumedOrder,
    ...overrides,
  } as Parameters<typeof useResumedCheckoutStartFunnel>[0];
}

describe('useResumedCheckoutStartFunnel', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reports the stamped total and currency for a resumed start', () => {
    renderHook(() => useResumedCheckoutStartFunnel(baseParams()));

    expect(captureCheckoutFunnelEventOnce).toHaveBeenCalledWith(
      'checkout_started',
      expect.any(String),
      expect.objectContaining({
        currency: 'USD',
        subtotal: 10000,
        total: 12000,
      })
    );
  });

  it('keeps the live cart values for a fresh start', () => {
    renderHook(() =>
      useResumedCheckoutStartFunnel(
        baseParams({
          hasCheckoutCartItems: true,
          displayItems: [{ id: 'line-1', kind: 'cart' as const, quantity: 1 }],
        })
      )
    );

    expect(captureCheckoutFunnelEventOnce).toHaveBeenCalledWith(
      'checkout_started',
      expect.any(String),
      expect.objectContaining({
        currency: 'NGN',
        total: 9000,
      })
    );
  });

  it('falls back to the cart values without a resumed order', () => {
    renderHook(() =>
      useResumedCheckoutStartFunnel(baseParams({ resumedOrder: null }))
    );

    expect(captureCheckoutFunnelEventOnce).toHaveBeenCalledWith(
      'checkout_started',
      expect.any(String),
      expect.objectContaining({
        currency: 'NGN',
        total: 9000,
      })
    );
  });
});
