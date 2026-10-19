import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { CartItem } from '@/hooks/cart/cart-types';
import type { Product } from '@/lib/products';
import { ProductDetailPurchasePanel } from './product-detail-purchase-panel';

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

const product = {
  id: 'p1',
  name: 'Widget',
  minimum_order_quantity: 1,
  has_variants: false,
} as Product;

const base = {
  product,
  hasEffectiveVariant: false,
  effectiveVariantId: null,
  quantity: 1,
  onQuantityChange: vi.fn(),
  updateQuantity: vi.fn(),
  getHref: (path: string) => path,
  isOutOfStock: false,
  routeOfferMissing: false,
  routeVariantMissing: false,
  hasCurrentVariantSelection: false,
  onAddToCart: vi.fn(),
};

describe('ProductDetailPurchasePanel', () => {
  it('steps the pre-add quantity and submits the cart add', () => {
    const onQuantityChange = vi.fn();
    const onAddToCart = vi.fn();
    render(
      <ProductDetailPurchasePanel
        {...base}
        cartItem={undefined}
        onQuantityChange={onQuantityChange}
        onAddToCart={onAddToCart}
      />
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Increase quantity of Widget' })
    );
    expect(onQuantityChange).toHaveBeenCalledWith(2);
    fireEvent.click(screen.getByRole('button', { name: 'Add to Cart' }));
    expect(onAddToCart).toHaveBeenCalled();
  });

  it('disables the add button when the selection is unorderable', () => {
    render(
      <ProductDetailPurchasePanel {...base} cartItem={undefined} isOutOfStock />
    );
    expect(screen.getByRole('button', { name: 'Add to Cart' })).toHaveProperty(
      'disabled',
      true
    );
  });

  it('edits the matched cart line and links to the cart', () => {
    const updateQuantity = vi.fn();
    const cartItem = {
      cartItemId: 'line-1',
      quantity: 2,
      variantAttributes: {},
    } as CartItem;
    render(
      <ProductDetailPurchasePanel
        {...base}
        cartItem={cartItem}
        updateQuantity={updateQuantity}
      />
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Increase quantity of Widget' })
    );
    expect(updateQuantity).toHaveBeenCalledWith('line-1', 3, undefined);
    expect(screen.getByText('View Cart and Checkout')).toBeDefined();
  });
});
