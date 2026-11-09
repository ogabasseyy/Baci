import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCartDrawerLifecycle } from './use-cart-drawer-lifecycle';

let mockPathname = '/products';

vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}));

describe('useCartDrawerLifecycle', () => {
  beforeEach(() => {
    mockPathname = '/products';
    vi.clearAllMocks();
  });

  it('initializes with default loading and error state', () => {
    const setIsCartOpen = vi.fn();
    const { result } = renderHook(() =>
      useCartDrawerLifecycle({ isCartOpen: true, setIsCartOpen })
    );

    expect(result.current.isCheckoutLoading).toBe(false);
    expect(result.current.isCheckoutLoadingRef.current).toBe(false);
    expect(result.current.checkoutError).toBeNull();
  });

  it('updates loading and error state via setters', () => {
    const setIsCartOpen = vi.fn();
    const { result } = renderHook(() =>
      useCartDrawerLifecycle({ isCartOpen: true, setIsCartOpen })
    );

    act(() => {
      result.current.setIsCheckoutLoading(true);
      result.current.setCheckoutError('Test error');
    });

    expect(result.current.isCheckoutLoading).toBe(true);
    expect(result.current.isCheckoutLoadingRef.current).toBe(true);
    expect(result.current.checkoutError).toBe('Test error');
  });

  it('resets loading and error when isCartOpen becomes false', () => {
    const setIsCartOpen = vi.fn();
    let isCartOpen = true;
    const { result, rerender } = renderHook(
      ({ open }) => useCartDrawerLifecycle({ isCartOpen: open, setIsCartOpen }),
      { initialProps: { open: isCartOpen } }
    );

    act(() => {
      result.current.setIsCheckoutLoading(true);
      result.current.setCheckoutError('Payment failed');
    });

    expect(result.current.isCheckoutLoading).toBe(true);

    isCartOpen = false;
    rerender({ open: false });

    expect(result.current.isCheckoutLoading).toBe(false);
    expect(result.current.isCheckoutLoadingRef.current).toBe(false);
    expect(result.current.checkoutError).toBeNull();
  });

  it('closes cart and resets states when pathname changes', () => {
    const setIsCartOpen = vi.fn();
    const { result, rerender } = renderHook(() =>
      useCartDrawerLifecycle({ isCartOpen: true, setIsCartOpen })
    );

    act(() => {
      result.current.setIsCheckoutLoading(true);
      result.current.setCheckoutError('Network timeout');
    });

    mockPathname = '/checkout';
    rerender();

    expect(setIsCartOpen).toHaveBeenCalledWith(false);
    expect(result.current.isCheckoutLoading).toBe(false);
    expect(result.current.checkoutError).toBeNull();
  });

  it('closes cart on unmount if open', () => {
    const setIsCartOpen = vi.fn();
    const { unmount } = renderHook(() =>
      useCartDrawerLifecycle({ isCartOpen: true, setIsCartOpen })
    );

    unmount();
    expect(setIsCartOpen).toHaveBeenCalledWith(false);
  });
});
