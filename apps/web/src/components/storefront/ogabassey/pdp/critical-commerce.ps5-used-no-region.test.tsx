import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Product } from '@/lib/products';
import { OgabasseyPdpCriticalCommerceClient } from './critical-commerce.client';

const cart = vi.hoisted(() => ({ addToCart: vi.fn(), setIsCartOpen: vi.fn() }));
vi.mock('@/hooks/cart', () => ({ useCart: () => cart }));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

// Live PlayStation 5 Console catalogue shape: every New console carries a
// region, the single Used console carries none.
const variantRows: Array<[string, string, Record<string, string>, number]> = [
  ['new-fat-eu', 'new', { model: 'Fat', region: 'Europe', storage: '825GB' }, 1_146_360],
  ['new-slim-eu', 'new', { model: 'Slim', region: 'Europe', storage: '1TB' }, 1_223_280],
  ['new-slim-jp', 'new', { model: 'Slim', region: 'Japan', storage: '1TB' }, 1_232_280],
  ['new-digital-eu', 'new', { model: 'Slim Digital', region: 'Europe', storage: '1TB' }, 1_123_680],
  ['used-standard', 'used', { model: 'Standard', storage: '825GB' }, 640_000],
];

const console5: Product = {
  id: 'ps5-console',
  name: 'PlayStation 5 Console',
  description: '',
  brand: 'PlayStation',
  gtin: '',
  mpn: 'playstation-5-console',
  image: '/ps5.avif',
  imageLarge: '/ps5.avif',
  imageHint: 'PS5',
  status: 'active',
  condition: 'used',
  price: 640_000,
  manage_stock: false,
  stock: 0,
  has_variants: true,
  variants: variantRows.map(([id, condition, attributes, price]) => ({
    id,
    product_id: 'ps5-console',
    merchant_id: 'merchant',
    condition,
    inventory_tracking_policy: 'off',
    stock_quantity: 0,
    price_override: price,
    attributes: { ...attributes, platform: 'PS5' },
  })),
};

function renderConsole() {
  return render(
    <OgabasseyPdpCriticalCommerceClient
      cartHref="/cart"
      cartProduct={console5}
      initialVariantSelection={{
        attributes: { model: 'Standard', storage: '825GB', platform: 'PS5' },
        variantId: 'used-standard',
      }}
      productName={console5.name}
      variantAxes={['condition', 'storage', 'region']}
      variantAxisOptions={{
        region: ['Europe', 'Japan'],
        storage: ['825GB', '1TB'],
        platform: ['PS5'],
        condition: ['new', 'used'],
      }}
      variantCount={5}
    />
  );
}

beforeEach(() => {
  cart.addToCart.mockClear();
});

describe('PS5 console whose Used variant has no region', () => {
  it('adds the advertised Used console without demanding a region it does not have', () => {
    renderConsole();

    const add = screen.getByRole('button', { name: 'Add to cart' });
    expect(add).not.toHaveAttribute('aria-disabled');
    fireEvent.click(add);

    expect(cart.addToCart).toHaveBeenCalledWith(
      expect.objectContaining({ price: 640_000 }),
      1,
      expect.objectContaining({ variantId: 'used-standard' })
    );
  });

  it('stays buyable after switching to New and back to Used', () => {
    renderConsole();

    fireEvent.click(screen.getByRole('button', { name: 'Select New condition' }));
    fireEvent.click(screen.getByRole('button', { name: 'Select Used condition' }));

    const add = screen.getByRole('button', { name: 'Add to cart' });
    expect(add).not.toHaveAttribute('aria-disabled');
    fireEvent.click(add);
    expect(cart.addToCart).toHaveBeenCalledWith(
      expect.objectContaining({ price: 640_000 }),
      1,
      expect.objectContaining({ variantId: 'used-standard' })
    );
  });

  it('still sells the New consoles by the region the shopper picks', () => {
    renderConsole();

    fireEvent.click(screen.getByRole('button', { name: 'Select New condition' }));
    fireEvent.click(screen.getByRole('button', { name: 'Select 1TB storage' }));

    fireEvent.click(screen.getByRole('button', { name: 'Select Japan region' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add to cart' }));
    expect(cart.addToCart).toHaveBeenCalledWith(
      expect.objectContaining({ price: 1_232_280 }),
      1,
      expect.objectContaining({ variantId: 'new-slim-jp' })
    );
  });
});
