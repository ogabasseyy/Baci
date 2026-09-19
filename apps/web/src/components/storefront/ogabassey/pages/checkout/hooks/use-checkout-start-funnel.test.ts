import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { captureCheckoutFunnelEventOnce } from '@/lib/posthog/capture-checkout-funnel-event';
import { useCheckoutStartFunnel } from './use-checkout-start-funnel';

vi.mock('@/lib/posthog/capture-checkout-funnel-event', () => ({
  captureCheckoutFunnelEventOnce: vi.fn(),
}));

describe('useCheckoutStartFunnel', () => {
  beforeEach(() => vi.clearAllMocks());

  const items = [{ id: 'line-1', kind: 'cart' as const, quantity: 2 }];

  it('captures a hydrated cart with stable funnel properties', () => {
    renderHook(() =>
      useCheckoutStartFunnel({
        displayItems: items,
        effectiveCheckoutCartTotal: 21500,
        effectiveItemSubtotal: 20000,
        isHydrated: true,
        merchantId: 'merchant-1',
      })
    );

    expect(captureCheckoutFunnelEventOnce).toHaveBeenCalledWith(
      'checkout_started',
      'cart:merchant-1:cart:line-1:2',
      expect.objectContaining({
        channel: 'web',
        item_count: 2,
        source: 'web_checkout',
        subtotal: 20000,
        total: 21500,
      })
    );
  });

  it('does not re-emit when the generation rotates after order creation', () => {
    const { rerender } = renderHook(
      ({ attemptId, hydrated }: { attemptId: string; hydrated: boolean }) =>
        useCheckoutStartFunnel({
          attemptId,
          displayItems: items,
          effectiveCheckoutCartTotal: 21500,
          effectiveItemSubtotal: 20000,
          isHydrated: hydrated,
          merchantId: 'merchant-1',
        }),
      { initialProps: { attemptId: 'gen-1', hydrated: true } }
    );

    expect(captureCheckoutFunnelEventOnce).toHaveBeenCalledTimes(1);

    // Post-order rerender: generation already rotated, but the completed
    // attempt must not emit a second start for the same cart.
    rerender({ attemptId: 'gen-2', hydrated: false });

    expect(captureCheckoutFunnelEventOnce).toHaveBeenCalledTimes(1);
  });

  it('scopes the dedupe key to the checkout attempt', () => {
    renderHook(() =>
      useCheckoutStartFunnel({
        attemptId: 'attempt-7',
        displayItems: items,
        effectiveCheckoutCartTotal: 21500,
        effectiveItemSubtotal: 20000,
        isHydrated: true,
        merchantId: 'merchant-1',
      })
    );

    expect(captureCheckoutFunnelEventOnce).toHaveBeenCalledWith(
      'checkout_started',
      'cart:merchant-1:attempt-7:cart:line-1:2',
      expect.objectContaining({ channel: 'web' })
    );
  });

  it.each([
    { isHydrated: false, label: 'not hydrated' },
    { isHydrated: true, label: 'empty cart', items: [] },
  ])('returns early for $label', ({ isHydrated, items: testItems = items }) => {
    renderHook(() =>
      useCheckoutStartFunnel({
        displayItems: testItems,
        effectiveCheckoutCartTotal: 21500,
        effectiveItemSubtotal: 20000,
        isHydrated,
        merchantId: 'merchant-1',
      })
    );

    expect(captureCheckoutFunnelEventOnce).not.toHaveBeenCalled();
  });
});
