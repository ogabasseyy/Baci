import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Product } from '@/lib/products';
import { QuickViewDetailsLink } from './quick-view-details-link';

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    onClick,
  }: {
    href: string;
    children: React.ReactNode;
    onClick: () => void;
  }) => (
    <a href={href} onClick={onClick}>
      {children}
    </a>
  ),
}));

const product: Product = {
  id: 'p1',
  name: 'Test Product',
  slug: 'test-product',
  description: '',
  status: 'active',
  price: 100,
  manage_stock: true,
  stock: 10,
  image: '/image.jpg',
  imageLarge: '/image.jpg',
  imageHint: '',
  brand: '',
  gtin: '',
  mpn: '',
};

describe('QuickViewDetailsLink', () => {
  it.each([
    '',
    '/home-makeover',
  ])('uses the storefront base path %s and closes quick view', (basePath) => {
    const onClose = vi.fn();
    render(
      <QuickViewDetailsLink
        product={product}
        basePath={basePath}
        onClose={onClose}
      />
    );
    const link = screen.getByRole('link', { name: 'View Full Details' });
    expect(link).toHaveAttribute('href', `${basePath}/products/test-product`);
    fireEvent.click(link);
    expect(onClose).toHaveBeenCalledOnce();
  });
});
