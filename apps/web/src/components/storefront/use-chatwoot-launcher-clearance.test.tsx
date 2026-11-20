import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CHATWOOT_BUBBLE_CLEARANCE_PROPERTY,
  CHATWOOT_CART_BOTTOM_CLEARANCE,
  useChatwootLauncherClearance,
} from './use-chatwoot-launcher-clearance';

const mocks = vi.hoisted(() => ({ pathname: '/shop' as string | null }));

vi.mock('next/navigation', () => ({
  usePathname: () => mocks.pathname,
}));

const clearance = () =>
  document.documentElement.style.getPropertyValue(
    CHATWOOT_BUBBLE_CLEARANCE_PROPERTY
  );

afterEach(() => {
  document.documentElement.style.removeProperty(
    CHATWOOT_BUBBLE_CLEARANCE_PROPERTY
  );
});

describe('useChatwootLauncherClearance', () => {
  it.each([
    ['/shop/cart', 'shop'],
    ['/cart', 'shop'],
    ['/shop/cart/', 'shop'],
    ['/cart', undefined],
  ])('lifts the launcher on the cart route %s', (pathname, slug) => {
    mocks.pathname = pathname;
    renderHook(() => useChatwootLauncherClearance(slug, true));

    expect(clearance()).toBe(CHATWOOT_CART_BOTTOM_CLEARANCE);
  });

  it.each([
    ['/shop', 'shop'],
    ['/shop/products/cart-case', 'shop'],
    ['/shop/cart-care', 'shop'],
    ['/shop/checkout', 'shop'],
    [null, 'shop'],
  ])('leaves the launcher alone on %s', (pathname, slug) => {
    mocks.pathname = pathname;
    renderHook(() => useChatwootLauncherClearance(slug, true));

    expect(clearance()).toBe('');
  });

  it('does nothing until the widget has started', () => {
    mocks.pathname = '/shop/cart';
    renderHook(() => useChatwootLauncherClearance('shop', false));

    expect(clearance()).toBe('');
  });

  it('drops the clearance when the shopper leaves the cart', () => {
    mocks.pathname = '/shop/cart';
    const { rerender } = renderHook(() =>
      useChatwootLauncherClearance('shop', true)
    );
    expect(clearance()).toBe(CHATWOOT_CART_BOTTOM_CLEARANCE);

    mocks.pathname = '/shop/products';
    rerender();
    expect(clearance()).toBe('');
  });

  it('drops the clearance when the storefront unmounts', () => {
    mocks.pathname = '/shop/cart';
    const { unmount } = renderHook(() =>
      useChatwootLauncherClearance('shop', true)
    );
    unmount();

    expect(clearance()).toBe('');
  });
});
