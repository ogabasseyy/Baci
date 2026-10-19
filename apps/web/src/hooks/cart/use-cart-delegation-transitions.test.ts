import { renderHook } from '@testing-library/react';
import { useState } from 'react';
import { expect, it, vi } from 'vitest';
import type { CartItem } from './cart-types';
import { useCartDelegationTransitions } from './use-cart-delegation-transitions';

it('fences enrollment rollback and discards the parked legacy cart before rendering it', () => {
  const bumpSessionGeneration = vi.fn();
  const { result, rerender } = renderHook(
    ({ delegated }) => {
      const [cart, setCart] = useState<CartItem[]>([
        {
          description: '',
          status: 'active',
          manage_stock: false,
          stock: 10,
          image: '',
          imageLarge: '',
          imageHint: '',
          brand: '',
          gtin: '',
          mpn: '',
          cartItemId: 'parked-line',
          id: 'parked',
          name: 'Old',
          price: 100,
          quantity: 1,
        },
      ]);
      const [merchantSlug, setMerchantSlugState] = useState<string | null>(
        'shop'
      );
      const [active, setCartWideNegotiationActiveState] = useState(true);
      const [isHydrated, setIsHydrated] = useState(false);
      useCartDelegationTransitions({
        delegated,
        merchantSlug,
        initialMerchantSlug: 'shop',
        merchantId: 'm',
        sharedCartEnabled: delegated,
        isHydrated,
        shared: { isHydrated: true },
        bumpSessionGeneration,
        setCart,
        setMerchantSlugState,
        setCartWideNegotiationActiveState,
        setIsHydrated,
      });
      return { cart, active, isHydrated };
    },
    { initialProps: { delegated: true } }
  );
  rerender({ delegated: false });
  expect(result.current).toEqual({ cart: [], active: false, isHydrated: true });
  expect(bumpSessionGeneration).toHaveBeenCalledOnce();
});

it('fences served merchant changes even when both merchants delegate', () => {
  const bumpSessionGeneration = vi.fn();
  const { result, rerender } = renderHook(
    ({ slug }) => {
      const [cart, setCart] = useState<CartItem[]>([]);
      const [merchantSlug, setMerchantSlugState] = useState<string | null>(
        'shop'
      );
      const [active, setCartWideNegotiationActiveState] = useState(true);
      const [isHydrated, setIsHydrated] = useState(false);
      useCartDelegationTransitions({
        delegated: true,
        merchantSlug,
        initialMerchantSlug: slug,
        merchantId: 'm',
        sharedCartEnabled: true,
        isHydrated,
        shared: { isHydrated: true },
        bumpSessionGeneration,
        setCart,
        setMerchantSlugState,
        setCartWideNegotiationActiveState,
        setIsHydrated,
      });
      return { cart, active, merchantSlug };
    },
    { initialProps: { slug: 'shop' } }
  );
  rerender({ slug: 'other' });
  expect(result.current.merchantSlug).toBe('other');
  expect(result.current.active).toBe(false);
  expect(bumpSessionGeneration).toHaveBeenCalledOnce();
});
