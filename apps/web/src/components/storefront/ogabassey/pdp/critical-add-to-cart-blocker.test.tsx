import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Product } from '@/lib/products';
import { resolveCriticalAddToCartBlocker } from './critical-add-to-cart-blocker';
import { OgabasseyPdpCriticalCommerceClient } from './critical-commerce.client';

const cart = vi.hoisted(() => ({ addToCart: vi.fn(), setIsCartOpen: vi.fn() }));
vi.mock('@/hooks/cart', () => ({ useCart: () => cart }));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

// Live shape that produced the report: several colours share the default
// condition / storage, so no colour is pre-selected on first load.
const phone: Product = {
  id: 'iphone',
  name: 'iPhone 18 Pro Max',
  description: '',
  brand: 'Apple',
  gtin: '',
  mpn: 'iphone-18-pro-max',
  image: '/phone.avif',
  imageLarge: '/phone.avif',
  imageHint: 'iPhone',
  status: 'active',
  condition: 'new',
  price: 2_250_000,
  manage_stock: false,
  stock: 0,
  has_variants: true,
  variants: ['Silver', 'Black'].map((color) => ({
    id: `256-${color}`,
    product_id: 'iphone',
    merchant_id: 'merchant',
    condition: 'new',
    inventory_tracking_policy: 'off',
    stock_quantity: 0,
    price_override: 2_250_000,
    attributes: { color, storage: '256GB' },
  })),
};

function renderBuyBox(product: Product = phone) {
  return render(
    <OgabasseyPdpCriticalCommerceClient
      cartHref="/cart"
      cartProduct={product}
      productName={product.name}
      variantAxes={['storage', 'color']}
      variantCount={product.variants?.length ?? 1}
    />
  );
}

beforeEach(() => {
  cart.addToCart.mockClear();
  cart.setIsCartOpen.mockClear();
});

describe('critical buy box when an option is still unchosen', () => {
  it('says which option to choose before the shopper taps', () => {
    renderBuyBox();

    const add = screen.getByRole('button', { name: 'Add to cart' });
    expect(add).toHaveAttribute('aria-disabled', 'true');
    expect(
      screen.getByText('Choose a color above to add this to your cart.')
    ).toHaveAttribute('role', 'status');
  });

  it('answers a blocked tap instead of doing nothing', () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    renderBuyBox();

    const add = screen.getByRole('button', { name: 'Add to cart' });
    // The regression: the button was `disabled`, so a tap fired nothing.
    expect(add).toBeEnabled();
    fireEvent.click(add);

    expect(cart.addToCart).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Choose a color above to add this to your cart.'
    );
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole('button', { name: 'Select Silver color' })
    ).toHaveFocus();
  });

  it('clears the reason and adds once the option is chosen', () => {
    renderBuyBox();

    fireEvent.click(screen.getByRole('button', { name: 'Add to cart' }));
    fireEvent.click(screen.getByRole('button', { name: 'Select Black color' }));

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText(/above to add this to your cart/)).toBeNull();
    const add = screen.getByRole('button', { name: 'Add to cart' });
    expect(add).not.toHaveAttribute('aria-disabled');
    fireEvent.click(add);
    expect(cart.addToCart).toHaveBeenCalledWith(
      expect.anything(),
      1,
      expect.objectContaining({ variantId: '256-Black' })
    );
  });

  it('keeps a sold-out product hard-disabled and says why', () => {
    render(
      <OgabasseyPdpCriticalCommerceClient
        cartHref="/cart"
        cartProduct={{
          ...phone,
          has_variants: false,
          variants: undefined,
          manage_stock: true,
          stock: 0,
        }}
        productName={phone.name}
        variantCount={1}
      />
    );

    expect(screen.getByRole('button', { name: 'Add to cart' })).toBeDisabled();
    expect(
      screen.getByText('This item is out of stock right now.')
    ).toHaveAttribute('role', 'status');
  });
});

describe('resolveCriticalAddToCartBlocker', () => {
  const base = {
    canAddToCart: false,
    maxQuantity: null,
    missingAxes: [],
    routeOfferMissingActive: false,
  };

  it('returns null when the selection is buyable', () => {
    expect(
      resolveCriticalAddToCartBlocker({ ...base, canAddToCart: true })
    ).toBeNull();
  });

  it('names every missing option group', () => {
    expect(
      resolveCriticalAddToCartBlocker({
        ...base,
        missingAxes: ['storage', 'sim_type', 'color'],
      })
    ).toMatchObject({
      kind: 'missing-selection',
      message:
        'Choose a storage, sim type and color above to add this to your cart.',
    });
  });

  it('points a removed offer at the condition choice', () => {
    expect(
      resolveCriticalAddToCartBlocker({
        ...base,
        missingAxes: ['color'],
        routeOfferMissingActive: true,
      })
    ).toMatchObject({ kind: 'offer-missing', axes: ['condition'] });
  });

  it('falls back to an unavailable-combination reason', () => {
    expect(resolveCriticalAddToCartBlocker(base)).toMatchObject({
      kind: 'unavailable',
    });
  });
});
