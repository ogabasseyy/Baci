import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CartItem } from '@/hooks/use-cart';
import type { Product } from '@/lib/products';
import { ProductGridItems } from './product-grid-items';

vi.mock('./product-card', () => ({
  StorefrontProductCard: ({
    product,
    cartItem,
    basePath,
  }: {
    product: Product;
    cartItem?: CartItem;
    basePath: string;
  }) => (
    <a href={`${basePath}/products/${product.slug}`}>
      {product.name}: {cartItem?.quantity ?? 0}
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

describe('ProductGridItems', () => {
  it.each([
    { columns: 2, expected: 'lg:grid-cols-2' },
    { columns: 99, expected: 'lg:grid-cols-4' },
  ])('renders items and cart quantities with columns $columns', ({
    columns,
    expected,
  }) => {
    const cartItem: CartItem = {
      ...product,
      cartItemId: 'cart-1',
      quantity: 3,
    };
    const { container } = render(
      <ProductGridItems
        products={[product, { ...product, id: 'p2', name: 'Other Product' }]}
        columns={columns}
        cartItemsMap={new Map([['p1', cartItem]])}
        basePath="/home-makeover"
        onAddToCart={vi.fn()}
        onUpdateQuantity={vi.fn()}
        onQuickView={vi.fn()}
      />
    );
    expect(
      screen.getByRole('link', { name: 'Test Product: 3' })
    ).toHaveAttribute('href', '/home-makeover/products/test-product');
    expect(
      screen.getByRole('link', { name: 'Other Product: 0' })
    ).toBeVisible();
    expect(container.firstChild).toHaveClass(expected);
  });
});
