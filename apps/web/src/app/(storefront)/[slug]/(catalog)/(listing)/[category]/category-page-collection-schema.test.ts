import { describe, expect, it } from 'vitest';
import type { RawDbProduct } from '@/lib/raw-db-product';
import { generateCollectionPageSchema } from '@/lib/seo-utils';
import {
  hasMaintainedCategoryCompareHubLink,
  normalizeCategoryPageProducts,
  type StorefrontCategoryProduct,
  toCollectionSchemaProduct,
} from './category-page-content-helpers';

function makeCategoryProduct(
  overrides: Partial<Omit<StorefrontCategoryProduct, 'condition'>> & {
    condition?: string;
  } = {}
): StorefrontCategoryProduct {
  return {
    id: 'product-1',
    name: 'PlayStation 5 Console',
    slug: 'playstation-5-console',
    description: 'Next-gen gaming console',
    price: '₦650,000',
    rawPrice: 650000,
    image: 'https://example.com/ps5.jpg',
    images: ['https://example.com/ps5.jpg'],
    category: 'Gaming',
    category_slug: 'gaming',
    brand: 'Sony',
    condition: 'New',
    stock: 10,
    manage_stock: true,
    ...(overrides as Partial<StorefrontCategoryProduct>),
  };
}

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
      toCollectionSchemaProduct(
        makeCategoryProduct({
          id: 'refurb',
          name: 'Refurb Phone',
          slug: 'refurb-phone',
          condition: 'REFURBISHED',
        })
      ).condition
    ).toBe('refurbished');
  });

  it('preserves manage_stock: false for unmanaged products', () => {
    expect(
      toCollectionSchemaProduct(
        makeCategoryProduct({
          id: 'unmanaged-prod',
          name: 'Unmanaged Product',
          slug: 'unmanaged-product',
          stock: 0,
          manage_stock: false,
        })
      ).manage_stock
    ).toBe(false);
  });

  it('preserves manage_stock: true for tracked products', () => {
    expect(
      toCollectionSchemaProduct(
        makeCategoryProduct({
          id: 'tracked-prod',
          name: 'Tracked Product',
          slug: 'tracked-product',
          stock: 0,
          manage_stock: true,
        })
      ).manage_stock
    ).toBe(true);
  });

  it('defaults manage_stock to false when undefined, following the normalized contract', () => {
    const productWithoutManageStock = makeCategoryProduct({
      id: 'legacy-prod',
      name: 'Legacy Product',
      slug: 'legacy-product',
      stock: 5,
    });
    delete productWithoutManageStock.manage_stock;

    expect(
      toCollectionSchemaProduct(productWithoutManageStock).manage_stock
    ).toBe(false);
  });
});

describe('normalizeCategoryPageProducts -> toCollectionSchemaProduct -> generateCollectionPageSchema', () => {
  it('threads manage_stock from raw DB products into schema availability', () => {
    const rawProducts: RawDbProduct[] = [
      {
        id: 'dropship-key',
        name: 'Digital Access Key',
        slug: 'digital-access-key',
        description: 'Instant license delivery',
        price: 5000,
        stock: 0,
        stock_quantity: 0,
        manage_stock: false,
        brand: 'Sony',
        images: ['https://example.com/key.jpg'],
        category: 'PlayStation 5',
      },
      {
        id: 'disc-edition',
        name: 'PS5 Disc Console',
        slug: 'ps5-disc-console',
        description: 'Physical console hardware',
        price: 650000,
        stock: 0,
        stock_quantity: 0,
        manage_stock: true,
        brand: 'Sony',
        images: ['https://example.com/ps5.jpg'],
        category: 'PlayStation 5',
      },
    ];

    const normalizedCategoryProducts = normalizeCategoryPageProducts(
      rawProducts,
      'playstation-5',
      'NG'
    );

    expect(normalizedCategoryProducts[0]?.manage_stock).toBe(false);
    expect(normalizedCategoryProducts[1]?.manage_stock).toBe(true);

    const schemaProducts = normalizedCategoryProducts.map(
      toCollectionSchemaProduct
    );

    expect(schemaProducts[0]?.manage_stock).toBe(false);
    expect(schemaProducts[1]?.manage_stock).toBe(true);

    const schema = generateCollectionPageSchema({
      name: 'PlayStation 5',
      url: 'https://ogabassey.com/playstation-5',
      products: schemaProducts,
      merchantName: 'Ogabassey',
    });

    // Dropshipped / unmanaged product with stock: 0 is InStock;
    // tracked sold-out physical product with stock: 0 is OutOfStock.
    expect(schema.mainEntity).toMatchObject({
      itemListElement: [
        {
          item: {
            offers: {
              availability: 'https://schema.org/InStock',
            },
          },
        },
        {
          item: {
            offers: {
              availability: 'https://schema.org/OutOfStock',
            },
          },
        },
      ],
    });
  });
});
