import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { MerchantContext } from '@/hooks/merchant/merchant-context';
import type { MerchantContextType } from '@/hooks/merchant/types';
import { CartContext } from './cart-context';
import type { CartContextType } from './cart-types';
import { useAssuranceDefaultNote } from './use-assurance-default-note';

function wrapper({
  cart,
  merchant,
  children,
}: {
  cart: Partial<CartContextType> | null;
  merchant: unknown;
  children: ReactNode;
}) {
  return (
    <MerchantContext.Provider
      value={{ merchant, loading: false } as unknown as MerchantContextType}
    >
      {cart === null ? (
        children
      ) : (
        <CartContext.Provider value={cart as CartContextType}>
          {children}
        </CartContext.Provider>
      )}
    </MerchantContext.Provider>
  );
}

const hydratedCart = {
  merchantSlug: 'ogabassey',
  hasSmartCartPro: true,
  isHydrated: true,
};

const enabledMerchant = {
  slug: 'ogabassey',
  feature_settings: { shipping_insurance_enabled: true },
};

describe('useAssuranceDefaultNote', () => {
  it('shows the note when a fresh add would default the fee on', () => {
    const { result } = renderHook(() => useAssuranceDefaultNote(), {
      wrapper: ({ children }) =>
        wrapper({ cart: hydratedCart, merchant: enabledMerchant, children }),
    });
    expect(result.current).toEqual({
      visible: true,
      label: 'Ogabassey Assurance',
    });
  });

  it.each([
    {
      label: 'cart not hydrated yet',
      cart: { ...hydratedCart, isHydrated: false },
      merchant: enabledMerchant,
    },
    {
      label: 'Smart Cart Pro off',
      cart: { ...hydratedCart, hasSmartCartPro: false },
      merchant: enabledMerchant,
    },
    {
      label: 'other cart merchant',
      cart: { ...hydratedCart, merchantSlug: 'another-store' },
      merchant: {
        slug: 'another-store',
        feature_settings: { shipping_insurance_enabled: true },
      },
    },
    {
      label: 'insurance disabled',
      cart: hydratedCart,
      merchant: {
        slug: 'ogabassey',
        feature_settings: { shipping_insurance_enabled: false },
      },
    },
    {
      label: 'insurance setting unknown',
      cart: hydratedCart,
      merchant: { slug: 'ogabassey', feature_settings: {} },
    },
    {
      label: 'context merchant mismatches the cart',
      cart: hydratedCart,
      merchant: {
        slug: 'another-store',
        feature_settings: { shipping_insurance_enabled: true },
      },
    },
    {
      label: 'no merchant context',
      cart: hydratedCart,
      merchant: null,
    },
  ])('hides the note when $label', ({ cart, merchant }) => {
    const { result } = renderHook(() => useAssuranceDefaultNote(), {
      wrapper: ({ children }) => wrapper({ cart, merchant, children }),
    });
    expect(result.current.visible).toBe(false);
  });

  it('hides the note outside a cart provider', () => {
    const { result } = renderHook(() => useAssuranceDefaultNote(), {
      wrapper: ({ children }) =>
        wrapper({ cart: null, merchant: enabledMerchant, children }),
    });
    expect(result.current.visible).toBe(false);
  });
});
