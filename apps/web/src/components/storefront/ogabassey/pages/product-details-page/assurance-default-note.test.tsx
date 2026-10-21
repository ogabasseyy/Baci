import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { CartContext } from '@/hooks/cart/cart-context';
import type { CartContextType } from '@/hooks/cart/cart-types';
import { MerchantContext } from '@/hooks/merchant/merchant-context';
import type { MerchantContextType } from '@/hooks/merchant/types';
import { AssuranceDefaultNote } from './assurance-default-note';

function wrapper({
  cart,
  merchant,
  children,
}: {
  cart: unknown;
  merchant: unknown;
  children: ReactNode;
}) {
  return (
    <MerchantContext.Provider
      value={{ merchant, loading: false } as unknown as MerchantContextType}
    >
      <CartContext.Provider value={cart as CartContextType}>
        {children}
      </CartContext.Provider>
    </MerchantContext.Provider>
  );
}

const enabledCart = {
  merchantSlug: 'ogabassey',
  hasSmartCartPro: true,
  isHydrated: true,
};

const enabledMerchant = {
  slug: 'ogabassey',
  feature_settings: { shipping_insurance_enabled: true },
};

describe('AssuranceDefaultNote', () => {
  it('discloses the default for a fresh purchasable add', () => {
    render(
      <AssuranceDefaultNote canPurchase quantityInCart={0} />,
      {
        wrapper: ({ children }) =>
          wrapper({ cart: enabledCart, merchant: enabledMerchant, children }),
      }
    );
    expect(screen.getByTestId('assurance-default-note')).toHaveTextContent(
      'Includes Ogabassey Assurance — review or remove it in your cart.'
    );
  });

  it('shows on rule-match when no exact-selection count is available', () => {
    render(<AssuranceDefaultNote canPurchase />, {
      wrapper: ({ children }) =>
        wrapper({ cart: enabledCart, merchant: enabledMerchant, children }),
    });
    expect(screen.getByTestId('assurance-default-note')).toBeInTheDocument();
  });

  it.each([
    {
      label: 'not purchasable',
      canPurchase: false,
      quantityInCart: 0,
      cart: enabledCart,
      merchant: enabledMerchant,
    },
    {
      label: 'line already in cart',
      canPurchase: true,
      quantityInCart: 2,
      cart: enabledCart,
      merchant: enabledMerchant,
    },
    {
      label: 'default would not apply',
      canPurchase: true,
      quantityInCart: 0,
      cart: enabledCart,
      merchant: {
        slug: 'ogabassey',
        feature_settings: { shipping_insurance_enabled: false },
      },
    },
  ])('renders nothing when $label', ({ canPurchase, quantityInCart, cart, merchant }) => {
    render(
      <AssuranceDefaultNote
        canPurchase={canPurchase}
        quantityInCart={quantityInCart}
      />,
      {
        wrapper: ({ children }) => wrapper({ cart, merchant, children }),
      }
    );
    expect(screen.queryByTestId('assurance-default-note')).toBeNull();
  });
});
