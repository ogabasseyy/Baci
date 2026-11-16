import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { Product } from '@/lib/products';
import { OgabasseyPdpCriticalCommerceClient } from './critical-commerce.client';

const cart = vi.hoisted(() => ({ addToCart: vi.fn(), setIsCartOpen: vi.fn() }));
vi.mock('@/hooks/cart', () => ({ useCart: () => cart }));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

type Row = [id: string, condition: string, attributes: Record<string, string>];

const VISIBLE_AXES = ['storage', 'sim_type', 'color', 'region'];

/**
 * Catalogue guard: merchants do not fill every option on every version
 * (a Used console with no region, a Used phone with no SIM type). No
 * such gap may leave a version that can never be added to the cart.
 */
const shapes: Record<string, Row[]> = {
  'one version has no region (live PS5 console)': [
    ['new-fat-eu', 'new', { model: 'Fat', region: 'Europe', storage: '825GB' }],
    ['new-slim-eu', 'new', { model: 'Slim', region: 'Europe', storage: '1TB' }],
    ['new-slim-jp', 'new', { model: 'Slim', region: 'Japan', storage: '1TB' }],
    ['used-standard', 'used', { model: 'Standard', storage: '825GB' }],
  ],
  'used versions have no colour': [
    ['new-black', 'new', { color: 'Black', storage: '256GB' }],
    ['new-silver', 'new', { color: 'Silver', storage: '256GB' }],
    ['used-256', 'used', { storage: '256GB' }],
    ['used-512', 'used', { storage: '512GB' }],
  ],
  'only some versions carry a SIM type': [
    ['new-esim', 'new', { sim_type: 'eSIM Only', storage: '256GB' }],
    ['new-dual', 'new', { sim_type: 'Physical + eSIM', storage: '256GB' }],
    ['used-128', 'used', { storage: '128GB' }],
  ],
  'one version has no options at all': [
    ['new-black', 'new', { color: 'Black' }],
    ['new-white', 'new', { color: 'White' }],
    ['used-plain', 'used', {}],
  ],
  'every option filled (control)': [
    ['a', 'new', { color: 'Black', storage: '128GB' }],
    ['b', 'new', { color: 'White', storage: '128GB' }],
    ['c', 'used', { color: 'Black', storage: '256GB' }],
  ],
};

function buildProduct(rows: Row[]): Product {
  return {
    id: 'product',
    name: 'Guard Product',
    description: '',
    brand: 'Brand',
    gtin: '',
    mpn: 'guard-product',
    image: '/p.avif',
    imageLarge: '/p.avif',
    imageHint: 'product',
    status: 'active',
    condition: 'new',
    price: 1000,
    manage_stock: false,
    stock: 0,
    has_variants: true,
    variants: rows.map(([id, condition, attributes], index) => ({
      id,
      product_id: 'product',
      merchant_id: 'merchant',
      condition,
      inventory_tracking_policy: 'off',
      stock_quantity: 0,
      price_override: 1000 + index,
      attributes,
    })),
  };
}

function axisOptions(rows: Row[]) {
  const options: Record<string, string[]> = {
    condition: [...new Set(rows.map(([, condition]) => condition))],
  };
  for (const [, , attributes] of rows) {
    for (const [axis, value] of Object.entries(attributes)) {
      options[axis] = [...new Set([...(options[axis] ?? []), value])];
    }
  }
  return options;
}

describe('every version of a product can be added to the cart', () => {
  for (const [shape, rows] of Object.entries(shapes)) {
    const options = axisOptions(rows);
    const variantAxes = [
      'condition',
      ...VISIBLE_AXES.filter((axis) => (options[axis]?.length ?? 0) > 1),
    ];

    for (const [variantId, condition, attributes] of rows) {
      it(`${shape}: ${variantId}`, () => {
        cart.addToCart.mockClear();
        const product = buildProduct(rows);
        render(
          <OgabasseyPdpCriticalCommerceClient
            cartHref="/cart"
            cartProduct={product}
            initialVariantSelection={{ attributes, condition, variantId }}
            productName={product.name}
            variantAxes={variantAxes}
            variantAxisOptions={options}
            variantCount={rows.length}
          />
        );

        const add = screen.getByRole('button', { name: 'Add to cart' });
        expect(add).not.toHaveAttribute('aria-disabled');
        fireEvent.click(add);
        expect(cart.addToCart).toHaveBeenCalledWith(
          expect.anything(),
          1,
          expect.objectContaining({ variantId })
        );
        cleanup();
      });
    }
  }
});
