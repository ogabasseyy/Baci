import { describe, expect, it } from 'vitest';
import { buildProductContextParagraphs } from './build-product-context-paragraphs';

describe('buildProductContextParagraphs availability copy', () => {
  it('renders checkout confirmation copy instead of out-of-stock copy when stock is null or manage_stock is false', () => {
    const nullStockParagraphs = buildProductContextParagraphs({
      merchantBusinessName: 'Ogabassey',
      categorySlug: 'smartphones',
      categoryName: 'Smartphones',
      currentProduct: {
        slug: 'samsung-galaxy-s25',
        name: 'Samsung Galaxy S25',
        price: 950_000,
        stock: null,
      },
    });

    expect(nullStockParagraphs[0]).toContain(
      'Live stock, selected options and delivery timing should still be confirmed at checkout.'
    );
    expect(nullStockParagraphs[0]).not.toContain('out of stock');

    const unmanagedZeroStockParagraphs = buildProductContextParagraphs({
      merchantBusinessName: 'Ogabassey',
      categorySlug: 'smartphones',
      categoryName: 'Smartphones',
      currentProduct: {
        slug: 'iphone-16-pro-max',
        name: 'iPhone 16 Pro Max',
        price: 1_950_000,
        stock: 0,
        manage_stock: false,
      },
    });

    expect(unmanagedZeroStockParagraphs[0]).toContain(
      'Live stock, selected options and delivery timing should still be confirmed at checkout.'
    );
    expect(unmanagedZeroStockParagraphs[0]).not.toContain('out of stock');
  });
});
