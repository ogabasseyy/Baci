import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useProductGridCart } from './use-product-grid-cart';

const mocks = vi.hoisted(() => ({
  addToCart: vi.fn(),
  cart: [] as Array<{ id: string }>,
  setMerchantSlug: vi.fn(),
  toast: vi.fn(),
  updateQuantity: vi.fn(),
}));

vi.mock('@/hooks/use-cart', () => ({
  useCart: () => ({
    cart: mocks.cart,
    addToCart: mocks.addToCart,
    updateQuantity: mocks.updateQuantity,
    setMerchantSlug: mocks.setMerchantSlug,
  }),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

describe('useProductGridCart', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cart = [];
  });

  it('resolves duplicate legacy IDs to the first match', () => {
    mocks.cart = [{ id: 'p1' }, { id: 'p1' }, { id: 'p2' }];

    const { result } = renderHook(() => useProductGridCart('slug'));

    expect(result.current.cartItemsMap.get('p1')).toEqual({ id: 'p1' });
    expect(result.current.cartItemsMap.get('p2')).toEqual({ id: 'p2' });
    expect(result.current.cartItemsMap.size).toBe(2);
  });

  it('stores the merchant slug and toasts on add', () => {
    const { result } = renderHook(() => useProductGridCart('my-shop'));
    const product = { id: 'p1', name: 'Phone' };

    result.current.handleAddToCart(product as never);

    expect(mocks.setMerchantSlug).toHaveBeenCalledWith('my-shop');
    expect(mocks.addToCart).toHaveBeenCalledWith(product);
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Added to cart' })
    );
  });

  it('skips the slug store when no slug is known', () => {
    const { result } = renderHook(() => useProductGridCart(undefined));

    result.current.handleAddToCart({ id: 'p1', name: 'Phone' } as never);

    expect(mocks.setMerchantSlug).not.toHaveBeenCalled();
    expect(mocks.addToCart).toHaveBeenCalled();
  });
});
