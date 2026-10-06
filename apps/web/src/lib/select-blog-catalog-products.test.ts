import { describe, expect, it } from 'vitest';
import { selectBlogCatalogProducts } from './select-blog-catalog-products';

describe('bounded inline price product selection', () => {
  const products = Array.from({ length: 40 }, (_, index) => ({
    id: `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`,
  }));
  it('retains a linked price reference beyond the eight-card display window', () => {
    const selected = selectBlogCatalogProducts(
      products,
      `{{catalog-price:${products[20].id}}}`
    );
    expect(selected).toEqual([...products.slice(0, 8), products[20]]);
  });
  it('does not add unrelated or unlinked products and bounds the hydration work', () => {
    expect(selectBlogCatalogProducts(products, '')).toEqual(
      products.slice(0, 8)
    );
    expect(
      selectBlogCatalogProducts(
        products,
        products.map((p) => `{{catalog-price:${p.id}}}`).join(' ')
      )
    ).toHaveLength(32);
  });
});
