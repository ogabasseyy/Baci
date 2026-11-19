// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCheckoutNavigation } from './use-checkout-navigation';

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  state: { searchParams: new URLSearchParams(), isReady: true },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push }),
}));
vi.mock('@/hooks/use-private-search-params', () => ({
  usePrivateSearchParamsState: () => mocks.state,
}));
vi.mock('@/lib/routes', () => ({ asRoute: (path: string) => path }));

function setup(isCartHydrated = true) {
  return renderHook(() =>
    useCheckoutNavigation({
      basePath: '/shop',
      isCartHydrated,
      merchantSlug: 'shop',
    })
  ).result.current;
}

describe('useCheckoutNavigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    mocks.state = { searchParams: new URLSearchParams(), isReady: true };
  });

  it('is hydrated only when the cart is hydrated and the stashed values are readable', () => {
    expect(setup(true).isHydrated).toBe(true);
    expect(setup(false).isHydrated).toBe(false);

    mocks.state = { searchParams: new URLSearchParams(), isReady: false };
    expect(setup(true).isHydrated).toBe(false);
  });

  it('builds storefront hrefs from the base path', () => {
    expect(setup().getHref('/order-success')).toBe('/shop/order-success');
  });

  it('pushes a token-free URL and hands the token over off the URL', () => {
    setup().routerPush('/shop/order-success?orderId=1&trackingToken=tok');

    expect(mocks.push).toHaveBeenCalledWith('/shop/order-success?orderId=1');
    expect(
      JSON.parse(
        window.sessionStorage.getItem('baci:private-url-params-pending') ??
          'null'
      )?.entries
    ).toEqual([['trackingToken', 'tok']]);
  });

  it('routes a success push through the same hand-off', () => {
    setup().pushSuccessRoute('/shop/order-success?orderId=1&trackingToken=tok');

    expect(mocks.push).toHaveBeenCalledWith('/shop/order-success?orderId=1');
  });

  it('pushes an href with nothing private unchanged', () => {
    setup().routerPush('/shop/cart');

    expect(mocks.push).toHaveBeenCalledWith('/shop/cart');
    expect(window.sessionStorage.length).toBe(0);
  });
});
