// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CartItem } from '@/hooks/cart';
import { useBeginCheckoutTracking } from './use-begin-checkout-tracking';

const beginCheckout = vi.fn();
const loadTracker = vi.fn(
  async () => ({ trackEvent: { beginCheckout } }) as never
);

function cartLine(overrides: Partial<CartItem> = {}): CartItem {
  return {
    id: 'prod-1',
    cartItemId: 'line-1',
    name: 'iPhone 15',
    price: 900_000,
    quantity: 1,
    category: 'Phones',
    ...overrides,
  } as CartItem;
}

let attempt = 0;

function params(overrides: Record<string, unknown> = {}) {
  return {
    attemptId: `gen-test-${attempt}`,
    checkoutCart: [cartLine()],
    currency: 'NGN',
    isHydrated: true,
    merchantId: 'merchant-1',
    loadTracker,
    ...overrides,
  };
}

describe('bugfix: storefront checkout never reported begin_checkout', () => {
  beforeEach(() => {
    attempt += 1;
    beginCheckout.mockClear();
    loadTracker.mockClear();
    window.sessionStorage.clear();
  });

  it('reports begin_checkout once with the live cart lines', async () => {
    renderHook(() =>
      useBeginCheckoutTracking(
        params({
          checkoutCart: [
            cartLine(),
            cartLine({
              id: 'prod-2',
              cartItemId: 'line-2',
              name: 'Case',
              price: 10_000,
              negotiatedPrice: 8_000,
              quantity: 2,
            }),
          ],
        })
      )
    );

    await vi.waitFor(() => expect(beginCheckout).toHaveBeenCalledTimes(1));
    expect(beginCheckout).toHaveBeenCalledWith(
      'merchant-1',
      [
        {
          product: expect.objectContaining({ id: 'prod-1', price: 900_000 }),
          quantity: 1,
        },
        {
          product: expect.objectContaining({ id: 'prod-2', price: 8_000 }),
          quantity: 2,
        },
      ],
      'NGN'
    );
  });

  it('does not report again on re-render or refresh of the same attempt', async () => {
    const shared = params();
    const { rerender, unmount } = renderHook(
      (props) => useBeginCheckoutTracking(props),
      { initialProps: shared }
    );
    await vi.waitFor(() => expect(beginCheckout).toHaveBeenCalledTimes(1));

    rerender({ ...shared, checkoutCart: [cartLine()] });
    unmount();
    renderHook(() => useBeginCheckoutTracking({ ...shared }));
    await Promise.resolve();

    expect(beginCheckout).toHaveBeenCalledTimes(1);
  });

  it('waits for the cart to hydrate', () => {
    renderHook(() => useBeginCheckoutTracking(params({ isHydrated: false })));

    expect(loadTracker).not.toHaveBeenCalled();
  });

  it('skips an empty cart (a resumed order is not a new checkout)', () => {
    renderHook(() => useBeginCheckoutTracking(params({ checkoutCart: [] })));

    expect(loadTracker).not.toHaveBeenCalled();
  });

  it('skips when the merchant is unknown', () => {
    renderHook(() =>
      useBeginCheckoutTracking(params({ merchantId: undefined }))
    );

    expect(loadTracker).not.toHaveBeenCalled();
  });

  it('does not report again when the shopper edits a quantity at checkout', async () => {
    const shared = params();
    const { rerender } = renderHook(
      (props) => useBeginCheckoutTracking(props),
      { initialProps: shared }
    );
    await vi.waitFor(() => expect(beginCheckout).toHaveBeenCalledTimes(1));

    rerender({ ...shared, checkoutCart: [cartLine({ quantity: 3 })] });
    await Promise.resolve();
    await Promise.resolve();

    expect(beginCheckout).toHaveBeenCalledTimes(1);
  });

  it('reports on a later render when the tracker failed to load the first time', async () => {
    loadTracker.mockRejectedValueOnce(new Error('chunk failed'));
    const shared = params();
    const { rerender } = renderHook(
      (props) => useBeginCheckoutTracking(props),
      { initialProps: shared }
    );
    await vi.waitFor(() => expect(loadTracker).toHaveBeenCalledTimes(1));

    rerender({ ...shared, checkoutCart: [cartLine()] });

    await vi.waitFor(() => expect(beginCheckout).toHaveBeenCalledTimes(1));
  });

  it('reports the catalog price for an unaccepted price proposal', async () => {
    renderHook(() =>
      useBeginCheckoutTracking(
        params({
          checkoutCart: [
            cartLine({ negotiatedPrice: 700_000, negotiationStatus: 'pending' }),
          ],
        })
      )
    );

    await vi.waitFor(() => expect(beginCheckout).toHaveBeenCalledTimes(1));
    expect(beginCheckout).toHaveBeenCalledWith(
      'merchant-1',
      [
        {
          product: expect.objectContaining({ price: 900_000 }),
          quantity: 1,
        },
      ],
      'NGN'
    );
  });
});
