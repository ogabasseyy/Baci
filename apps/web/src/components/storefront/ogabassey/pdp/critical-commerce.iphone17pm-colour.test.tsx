import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { Product } from '@/lib/products';
import {
  OgabasseyPdpCriticalCommerceClient,
  OgabasseyPdpCriticalCommerceProvider,
} from './critical-commerce.client';

const cart = vi.hoisted(() => ({ addToCart: vi.fn(), setIsCartOpen: vi.fn() }));
vi.mock('@/hooks/cart', () => ({ useCart: () => cart }));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

const product: Product = {
  id: 'iphone17pm',
  name: 'iPhone 17 Pro Max',
  description: '',
  brand: 'Apple',
  gtin: '',
  mpn: 'iphone-17-pro-max',
  image: '/phone.avif',
  imageLarge: '/phone.avif',
  imageHint: 'iPhone',
  status: 'active',
  condition: 'new',
  price: 2343000,
  manage_stock: false,
  stock: 0,
  has_variants: true,
  variants: ['Deep Blue', 'Silver', 'Cosmic Orange'].map((color) => ({
    id: `512-physical-${color}`,
    product_id: 'iphone17pm',
    merchant_id: 'merchant',
    condition: 'new',
    inventory_tracking_policy: 'off',
    stock_quantity: 0,
    price_override: 2343000,
    attributes: { color, storage: '512GB', sim_type: 'Physical + eSIM' },
  })),
};

describe('iPhone 17 Pro Max critical purchase flow', () => {
  it('exposes colour when multiple unmanaged SKUs share New / 512GB / Physical + eSIM', () => {
    render(
      <OgabasseyPdpCriticalCommerceProvider
        cartProduct={product}
        variantAxes={['condition', 'storage', 'sim_type']}
        variantCount={3}
      >
        <OgabasseyPdpCriticalCommerceClient
          cartHref="/cart"
          cartProduct={product}
          productName={product.name}
          variantCount={3}
        />
      </OgabasseyPdpCriticalCommerceProvider>
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Select Silver color' })
    );
    const add = screen.getByRole('button', { name: /^Add to cart$/ });
    expect(add).toBeEnabled();
    fireEvent.click(add);
    expect(cart.addToCart).toHaveBeenCalledWith(
      expect.objectContaining({ manage_stock: false, price: 2343000 }),
      1,
      expect.objectContaining({
        variantId: '512-physical-Silver',
        storage: '512GB',
      })
    );
  });
});
