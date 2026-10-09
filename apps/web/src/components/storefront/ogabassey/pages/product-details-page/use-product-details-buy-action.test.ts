import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Product } from '../../types';
import type { NormalizedProductDetails } from './product-details-helpers';
import { useProductDetailsBuyAction } from './use-product-details-buy-action';

type BuyActionArgs = Parameters<typeof useProductDetailsBuyAction>[0];

const mockBuildCartProduct = vi.fn((..._args: unknown[]) => ({
  id: 'cart-product',
}));
const mockResolveCurrentOffer = vi.fn((..._args: unknown[]) => ({
  price: 5000,
}));

vi.mock('./product-details-helpers', () => ({
  buildCartProduct: (...args: unknown[]) => mockBuildCartProduct(...args),
}));

vi.mock('./offer-resolution', () => ({
  resolveCurrentOffer: (...args: unknown[]) => mockResolveCurrentOffer(...args),
}));

vi.mock('@/lib/routes', () => ({
  asRoute: (url: string) => url,
}));

const productData = {
  id: 'product-1',
  name: 'Pixel 9',
  colors: [{ name: 'Black' }, { name: 'Silver' }],
} as unknown as NormalizedProductDetails;

const serverProduct = { id: 'product-1', name: 'Pixel 9' } as Product;

function makeSearchParams(query = '') {
  return new URLSearchParams(query);
}

function renderBuyAction(
  overrides: {
    query?: string;
    routeResolvedVariantSelection?: Parameters<
      typeof useProductDetailsBuyAction
    >[0]['routeResolvedVariantSelection'];
    selectedCondition?: Parameters<
      typeof useProductDetailsBuyAction
    >[0]['selectedCondition'];
  } = {}
) {
  const addToCart = vi.fn();
  const routerPush = vi.fn();
  const toast = vi.fn();
  const checkoutRedirectTimeoutRef = { current: null as number | null };

  const utils = renderHook(() =>
    useProductDetailsBuyAction({
      addToCart,
      basePath: '/ogabassey',
      checkoutRedirectTimeoutRef,
      productData,
      routeResolvedVariantSelection:
        overrides.routeResolvedVariantSelection ?? null,
      routerPush,
      searchParams: makeSearchParams(overrides.query),
      selectedCondition: overrides.selectedCondition ?? 'new',
      serverProduct,
      toast: toast as unknown as BuyActionArgs['toast'],
    })
  );

  return { ...utils, addToCart, routerPush, toast, checkoutRedirectTimeoutRef };
}

describe('useProductDetailsBuyAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it('adds to cart and schedules a cart redirect when action=buy is present', () => {
    const { addToCart, routerPush, toast } = renderBuyAction({
      query: 'action=buy',
    });

    expect(addToCart).toHaveBeenCalledOnce();
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Added to cart' })
    );
    expect(routerPush).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(500);
    });

    // The cart carries the assurance disclosure and opt-out toggle, so the
    // buy flow must land there instead of skipping straight to checkout.
    expect(routerPush).toHaveBeenCalledWith('/ogabassey/cart');
  });

  it('does NOT add to cart or redirect when the buy param is absent', () => {
    const { addToCart, routerPush } = renderBuyAction({ query: '' });

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(addToCart).not.toHaveBeenCalled();
    expect(routerPush).not.toHaveBeenCalled();
  });

  it('runs the buy action only once across rerenders', () => {
    const { addToCart, rerender } = renderBuyAction({ query: 'action=buy' });

    rerender();
    rerender();

    expect(addToCart).toHaveBeenCalledOnce();
  });

  it('passes the resolved variant attributes when seeding the cart', () => {
    const { addToCart } = renderBuyAction({
      query: 'action=buy',
      routeResolvedVariantSelection: {
        attributes: { storage: '256GB' },
        color: 'Silver',
        condition: 'used',
        variant: { id: 'variant-silver' },
      } as never,
    });

    expect(addToCart).toHaveBeenCalledWith(
      expect.anything(),
      1,
      expect.objectContaining({
        color: 'Silver',
        condition: 'used',
        variantId: 'variant-silver',
      })
    );
  });

  it('seeds a non-variant buy from the resolved selection condition', () => {
    const { addToCart } = renderBuyAction({
      query: 'action=buy&offer_id=offer-used-1',
      routeResolvedVariantSelection: null,
      selectedCondition: 'used',
    });

    expect(mockResolveCurrentOffer).toHaveBeenCalledWith(
      productData,
      'used',
      {},
      null,
      undefined
    );
    expect(addToCart).toHaveBeenCalledWith(
      expect.anything(),
      1,
      expect.objectContaining({ condition: 'used' })
    );
  });

  it('clears a pending redirect timeout on unmount', () => {
    const { unmount, checkoutRedirectTimeoutRef } = renderBuyAction({
      query: 'action=buy',
    });

    expect(checkoutRedirectTimeoutRef.current).not.toBeNull();

    unmount();

    expect(checkoutRedirectTimeoutRef.current).toBeNull();
  });
});
