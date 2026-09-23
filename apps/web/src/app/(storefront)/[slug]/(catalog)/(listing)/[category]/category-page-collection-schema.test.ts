import { describe, expect, it } from 'vitest';
import {
  hasMaintainedCategoryCompareHubLink,
  type StorefrontCategoryProduct,
  toCollectionSchemaProduct,
} from './category-page-content-helpers';

describe('hasMaintainedCategoryCompareHubLink', () => {
  it('detects category compare hub links across absolute and prefixed hrefs', () => {
    expect(
      hasMaintainedCategoryCompareHubLink(
        [
          {
            href: 'https://ogabassey.com/smartphones/compare',
            label: 'View all smartphones comparisons',
          },
          {
            href: '/ogabassey/laptops/compare',
            label: 'View laptop comparisons',
          },
        ],
        'laptops'
      )
    ).toBe(true);
  });

  it('ignores product comparison links that are not the maintained hub', () => {
    expect(
      hasMaintainedCategoryCompareHubLink(
        [
          {
            href: '/smartphones/compare/google-pixel-8-vs-xiaomi-13t',
            label: 'Compare Google Pixel 8 with Xiaomi 13T',
          },
        ],
        'smartphones'
      )
    ).toBe(false);
  });
});

describe('toCollectionSchemaProduct', () => {
  it('maps refurbished casing variants to the refurbished schema condition', () => {
    expect(
      toCollectionSchemaProduct({
        id: 'refurb',
        name: 'Refurb Phone',
        description: 'Restored',
        price: '₦1,000',
        rawPrice: 1000,
        stock: 1,
        image: '/phone.png',
        category: 'phones',
        category_slug: 'phones',
        slug: 'refurb-phone',
        condition: 'REFURBISHED',
      } as unknown as StorefrontCategoryProduct).condition
    ).toBe('refurbished');
  });
});
