import { describe, expect, it } from 'vitest';
import type { Product } from '@/lib/products';
import { gateAddToCart } from './gate-add-to-cart';

const product = {
  id: 'product',
  name: 'Phone',
  price: 100,
  manage_stock: true,
  stock: 1,
} as Product;
describe('gateAddToCart', () => {
  it('allows an available ordinary line', () => {
    expect(gateAddToCart(product)).toEqual({ product, options: undefined });
  });
  it('blocks out of stock ordinary lines and unresolved variants', () => {
    expect(gateAddToCart({ ...product, stock: 0 })).toBeNull();
    expect(gateAddToCart({ ...product, has_variants: true })).toBeNull();
  });
  it('allows the winner to add a reserved prize at zero public stock', () => {
    expect(
      gateAddToCart({ ...product, stock: 0 }, { quizAwardId: 'award' })
    ).not.toBeNull();
  });
});
