import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useStorefrontCartSessionHandlers } from './use-storefront-cart-session-handlers';

vi.mock('./cart-storage', async (importOriginal) => {
  const original = (await importOriginal()) as Record<string, unknown>;
  return {
    ...original,
    saveCartToStorage: vi.fn(),
    saveCartWideNegotiationToStorage: vi.fn(),
    saveMerchantSlugToStorage: vi.fn(),
  };
});
vi.mock('./merchant-cart-storage', () => ({
  getMerchantCartState: vi.fn(() => ({
    cart: [],
    cartWideNegotiationActive: false,
  })),
}));

function setup(overrides: Record<string, unknown> = {}) {
  const setCart = vi.fn();
  const setMerchantSlugState = vi.fn();
  const delegatedActions = { clearCart: vi.fn() };
  const { result } = renderHook(() =>
    useStorefrontCartSessionHandlers({
      bumpSessionGeneration: vi.fn(),
      delegated: false,
      delegatedActions,
      initialMerchantSlug: 'shop',
      merchantId: 'merchant-1',
      merchantSlug: 'shop',
      merchantSlugRef: { current: 'shop' },
      setCart,
      setCartWideNegotiationActive: vi.fn(),
      setIsHydrated: vi.fn(),
      setMerchantSlugState,
      sharedCartEnabled: false,
      ...overrides,
    } as never)
  );
  return { result, setCart, setMerchantSlugState, delegatedActions };
}

describe('useStorefrontCartSessionHandlers', () => {
  it('clears legacy cart state and unbinds the merchant slug', () => {
    const { result, setCart, setMerchantSlugState } = setup();
    result.current.clearCart();
    expect(setCart).toHaveBeenCalledWith([]);
    expect(setMerchantSlugState).toHaveBeenCalledWith(null);
  });

  it('delegates clearing when delegated', () => {
    const { result, setCart, delegatedActions } = setup({
      delegated: true,
    });
    result.current.clearCart();
    expect(delegatedActions.clearCart).toHaveBeenCalled();
    expect(setCart).not.toHaveBeenCalled();
  });

  it('switches the merchant slug and fences the prior session', () => {
    const bumpSessionGeneration = vi.fn();
    const { result, setMerchantSlugState } = setup({
      bumpSessionGeneration,
    });
    result.current.setMerchantSlug('other-shop');
    expect(setMerchantSlugState).toHaveBeenCalledWith('other-shop');
    expect(bumpSessionGeneration).toHaveBeenCalled();
  });
});
