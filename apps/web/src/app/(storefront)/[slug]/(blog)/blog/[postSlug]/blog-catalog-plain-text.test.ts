import { describe, expect, it } from 'vitest';
import { resolveBlogCatalogPlainText } from './blog-catalog-plain-text';

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';

describe('resolveBlogCatalogPlainText', () => {
  it('resolves price tokens and decodes sanitizer entities to literal text', () => {
    expect(
      resolveBlogCatalogPlainText(
        `Phones from AT&T partner stores: {{catalog-price:${PRODUCT_ID}}}.`,
        {
          products: [
            {
              id: PRODUCT_ID,
              name: 'Phone',
              price: 250000,
              manage_stock: false,
            },
          ],
          currencySource: { country: 'NG', payout_currency: 'NGN' },
        }
      )
    ).toBe('Phones from AT&T partner stores: ₦250,000.00.');
  });

  it('returns the input unchanged when no catalog prices are supplied', () => {
    expect(resolveBlogCatalogPlainText('Fish & Chips')).toBe('Fish & Chips');
  });
});
