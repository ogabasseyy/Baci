import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Product as CartProduct } from '@/lib/products';
import { OgabasseyPdpCriticalCommerceClient } from './critical-commerce.client';

const cartMocks = vi.hoisted(() => ({
  addToCart: vi.fn(),
  cart: [] as Array<Record<string, unknown>>,
  removeFromCart: vi.fn(),
  setIsCartOpen: vi.fn(),
  updateQuantity: vi.fn(),
}));

vi.mock('@/hooks/cart', () => ({
  useCart: () => ({
    addToCart: cartMocks.addToCart,
    cart: cartMocks.cart,
    removeFromCart: cartMocks.removeFromCart,
    setIsCartOpen: cartMocks.setIsCartOpen,
    updateQuantity: cartMocks.updateQuantity,
  }),
}));

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    prefetch,
    ...props
  }: {
    children: ReactNode;
    href: string;
    prefetch?: boolean;
  }) => (
    <a href={href} data-prefetch={String(prefetch)} {...props}>
      {children}
    </a>
  ),
}));

beforeEach(() => {
  cartMocks.addToCart.mockClear();
  cartMocks.removeFromCart.mockClear();
  cartMocks.setIsCartOpen.mockClear();
  cartMocks.updateQuantity.mockClear();
  cartMocks.cart = [];
});

const cartProduct: CartProduct = {
  brand: 'Dell',
  condition: 'used',
  description: 'Dell Alienware m18 R3 (RTX 5080)',
  gtin: '',
  id: 'product-1',
  image: 'https://cdn.ogabassey.com/alienware.avif',
  imageHint: 'Dell Alienware m18 R3 (RTX 5080)',
  imageLarge: 'https://cdn.ogabassey.com/alienware.avif',
  manage_stock: true,
  mpn: 'dell-alienware-m18-r3-rtx-5080',
  name: 'Dell Alienware m18 R3 (RTX 5080)',
  price: 7_098_000,
  status: 'active',
  stock: 4,
};

describe('OgabasseyPdpCriticalCommerceClient stock and quantity bounds', () => {
  it('caps in-cart quantity increments at managed stock', () => {
    cartMocks.cart = [
      {
        cartItemId: 'product-1::condition=used',
        condition: 'used',
        id: 'product-1',
        quantity: 2,
      },
    ];
    render(
      <OgabasseyPdpCriticalCommerceClient
        cartHref="/cart"
        cartProduct={{
          ...cartProduct,
          stock: 2,
        }}
        productName={cartProduct.name}
        variantCount={1}
      />
    );

    const increaseButton = screen.getByRole('button', {
      name: /increase quantity/i,
    });
    const decreaseButton = screen.getByRole('button', {
      name: /decrease quantity/i,
    });

    expect(screen.getByText('2')).toBeInTheDocument();
    expect(increaseButton).toBeDisabled();

    fireEvent.click(decreaseButton);
    expect(cartMocks.updateQuantity).toHaveBeenCalledWith(
      'product-1::condition=used',
      1,
      undefined
    );
  });

  it('blocks cart additions when managed stock is exhausted', () => {
    render(
      <OgabasseyPdpCriticalCommerceClient
        cartHref="/cart"
        cartProduct={{
          ...cartProduct,
          stock: 0,
        }}
        productName={cartProduct.name}
        variantCount={1}
      />
    );

    const addButton = screen.getByRole('button', { name: /add to cart/i });
    expect(addButton).toBeDisabled();

    fireEvent.click(addButton);

    expect(cartMocks.addToCart).not.toHaveBeenCalled();
    expect(cartMocks.setIsCartOpen).not.toHaveBeenCalled();
  });

  it('keeps stock-zero products unlimited when stock management is disabled', () => {
    const unmanagedProduct = {
      ...cartProduct,
      manage_stock: false,
      stock: 0,
    };

    render(
      <OgabasseyPdpCriticalCommerceClient
        cartHref="/cart"
        cartProduct={unmanagedProduct}
        productName={cartProduct.name}
        variantCount={1}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /add to cart/i }));

    expect(cartMocks.addToCart).toHaveBeenCalledWith(unmanagedProduct, 1, {
      condition: 'used',
    });
    expect(cartMocks.setIsCartOpen).not.toHaveBeenCalled();
  });
});
