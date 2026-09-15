import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { expect, it, vi } from 'vitest';
import type { Product as CartProduct } from '@/lib/products';
import { OgabasseyPdpCriticalCommerceClient } from './critical-commerce.client';

vi.mock('@/hooks/cart', () => ({
  useCart: () => ({ addToCart: vi.fn(), setIsCartOpen: vi.fn() }),
}));
vi.mock('next/link', () => ({
  default: ({ children, href, prefetch, ...props }: { children: ReactNode; href: string; prefetch?: boolean }) => (
    <a href={href} data-prefetch={String(prefetch)} {...props}>{children}</a>
  ),
}));

const product: CartProduct = {
  brand: 'Dell', condition: 'used', description: 'Dell Alienware m18 R3',
  gtin: '', id: 'product-1', image: 'https://cdn.ogabassey.com/alienware.avif',
  imageHint: 'Dell Alienware m18 R3', imageLarge: 'https://cdn.ogabassey.com/alienware.avif',
  manage_stock: true, mpn: 'dell-alienware-m18-r3', name: 'Dell Alienware m18 R3',
  price: 7_098_000, status: 'active', stock: 4,
};

it('keeps cart styles off the initial product load', () => {
  render(<OgabasseyPdpCriticalCommerceClient cartHref="/cart" cartProduct={product} productName={product.name} variantCount={0} />);
  expect(screen.getByRole('link', { name: 'View cart' })).toHaveAttribute('data-prefetch', 'false');
});
