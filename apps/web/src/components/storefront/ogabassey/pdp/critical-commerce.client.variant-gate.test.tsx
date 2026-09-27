import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { Product as CartProduct } from '@/lib/products';
import { OgabasseyPdpCriticalCommerceClient } from './critical-commerce.client';

const addToCart = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/cart', () => ({
  useCart: () => ({ addToCart, setIsCartOpen: vi.fn() }),
}));
vi.mock('next/link', () => ({ default: ({ children }: { children: ReactNode }) => <a>{children}</a> }));

const product: CartProduct = {
  brand: 'Dell', condition: 'used', description: 'Laptop', gtin: '', id: 'p1',
  image: 'https://cdn.example.com/p.avif', imageHint: 'Laptop', imageLarge: 'https://cdn.example.com/p.avif',
  manage_stock: true, mpn: 'p1', name: 'Laptop', price: 100, status: 'active', stock: 4,
  has_variants: true,
  variants: [
    { id: 'v1', product_id: 'p1', merchant_id: 'm1', attributes: { storage: '128GB', ram: '4GB' }, price_override: 80, stock_quantity: 4 },
    { id: 'v2', product_id: 'p1', merchant_id: 'm1', attributes: { storage: '256GB', ram: '8GB' }, price_override: 100, stock_quantity: 4 },
  ],
};

beforeEach(() => addToCart.mockClear());

it('keeps add to cart disabled until all required variant axes are selected', () => {
  render(<OgabasseyPdpCriticalCommerceClient cartHref="/cart" cartProduct={product} productName={product.name} variantAxes={['storage', 'ram']} variantCount={2} />);
  fireEvent.click(screen.getByRole('button', { name: /select 256gb storage/i }));
  expect(screen.getByRole('button', { name: /add to cart/i })).toBeDisabled();
  expect(addToCart).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: /select 8gb ram/i }));
  expect(screen.getByRole('button', { name: /add to cart/i })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: /add to cart/i }));
  expect(addToCart).toHaveBeenCalled();
});
