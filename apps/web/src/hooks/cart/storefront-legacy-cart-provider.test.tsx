import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Product } from '@/lib/products';
import { useCart } from './cart-context';
import { StorefrontLegacyCartProvider } from './storefront-legacy-cart-provider';

const sampleProduct: Product = {
  id: 'prod-legacy-1',
  name: 'Legacy Phone',
  description: '',
  status: 'active',
  price: 250,
  manage_stock: true,
  stock: 5,
  image: '/phone.jpg',
  imageLarge: '/phone.jpg',
  imageHint: 'phone',
  brand: 'Brand',
  gtin: '123',
  mpn: '123',
};

describe('StorefrontLegacyCartProvider', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  it('hydrates and mutates the local cart with sharedCartEnabled false', async () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <StorefrontLegacyCartProvider merchantSlug="ogabassey">
        {children}
      </StorefrontLegacyCartProvider>
    );

    const { result } = renderHook(() => useCart(), { wrapper });
    await waitFor(() => expect(result.current.isHydrated).toBe(true));
    expect(result.current.sharedCartEnabled).toBe(false);

    act(() => {
      result.current.addToCart(sampleProduct, 2);
    });

    expect(result.current.cartCount).toBe(2);
    expect(result.current.cartTotal).toBe(500);
  });

  it('suppresses legacy hydration while deferHydration is true', async () => {
    window.localStorage.setItem(
      'baci-cart-ogabassey-guest',
      JSON.stringify([{ ...sampleProduct, cartItemId: 'line-1', quantity: 1 }])
    );

    const wrapper = ({ children }: { children: ReactNode }) => (
      <StorefrontLegacyCartProvider deferHydration merchantSlug="ogabassey">
        {children}
      </StorefrontLegacyCartProvider>
    );

    const { result } = renderHook(() => useCart(), { wrapper });
    expect(result.current.isHydrated).toBe(false);
    expect(result.current.cart).toEqual([]);
  });
});
