import { describe, expect, it } from 'vitest';
import type { CategoryHubModel } from '@/lib/storefront-category/category-hub-types';
import {
  type StorefrontCategoryProduct,
  toCollectionSchemaProduct,
} from './category-page-content-helpers';
import { buildCategoryPageContentSchemas } from './category-page-content-schema';

function buildHub(overrides: Partial<CategoryHubModel> = {}): CategoryHubModel {
  return {
    intro: {
      heading: 'Gaming Laptops',
      description: 'Shop gaming laptops.',
    } as CategoryHubModel['intro'],
    trustFeatures: [],
    bestForCards: [],
    brandCards: [],
    priceBandCards: [],
    comparisonLinks: [],
    guideLinks: [],
    faqItems: [],
    ...overrides,
  } as CategoryHubModel;
}

function buildProduct() {
  return toCollectionSchemaProduct({
    id: 'product-1',
    name: 'RTX Laptop',
    description: 'A laptop',
    rawPrice: 1500000,
    image: 'https://ogabassey.com/p1.jpg',
    brand: 'Brand',
    category: 'Gaming Laptops',
    category_slug: 'gaming-laptops',
    slug: 'rtx-laptop',
  } as StorefrontCategoryProduct);
}

const BASE_INPUT = {
  baseUrl: 'https://ogabassey.com',
  canonicalCategoryUrl: 'https://ogabassey.com/gaming-laptops',
  categoryName: 'gaming-laptops',
  country: 'NG',
  currencyCode: 'NGN',
  isCollection: true,
  merchantBusinessName: 'Demo Store',
  paginatedCategoryUrl: 'https://ogabassey.com/gaming-laptops',
  parent: null,
  products: [buildProduct()],
} as const;

describe('buildCategoryPageContentSchemas', () => {
  it('names the collection from the SEO page name and canonical page URL', () => {
    const schemas = buildCategoryPageContentSchemas({
      ...BASE_INPUT,
      hubContent: buildHub(),
      products: [...BASE_INPUT.products],
      seoPageName: 'RTX 4070 Gaming Laptops',
    });

    expect(schemas.collectionSchema).toMatchObject({
      name: 'RTX 4070 Gaming Laptops',
      url: 'https://ogabassey.com/gaming-laptops',
    });
  });

  it('omits the parent crumb for collections', () => {
    const schemas = buildCategoryPageContentSchemas({
      ...BASE_INPUT,
      hubContent: buildHub(),
      products: [...BASE_INPUT.products],
    });

    expect(schemas.breadcrumbSchema.itemListElement).toHaveLength(2);
  });

  it('inserts the parent crumb for non-collection categories', () => {
    const schemas = buildCategoryPageContentSchemas({
      ...BASE_INPUT,
      hubContent: buildHub(),
      isCollection: false,
      parent: { name: 'Laptops', slug: 'laptops' },
      products: [...BASE_INPUT.products],
    });

    expect(schemas.breadcrumbSchema.itemListElement).toHaveLength(3);
  });

  it('returns no FAQ schema without faq items', () => {
    const schemas = buildCategoryPageContentSchemas({
      ...BASE_INPUT,
      hubContent: buildHub({ faqItems: [] }),
      products: [...BASE_INPUT.products],
    });

    expect(schemas.faqSchema).toBeNull();
  });

  it('returns an FAQ schema with every faq item', () => {
    const schemas = buildCategoryPageContentSchemas({
      ...BASE_INPUT,
      hubContent: buildHub({
        faqItems: [
          { question: 'What GPU?', answer: 'RTX 4070.' },
          { question: 'How much RAM?', answer: '16GB.' },
        ],
      }),
      products: [...BASE_INPUT.products],
    });

    expect(schemas.faqSchema).toMatchObject({ '@type': 'FAQPage' });
    expect(
      (schemas.faqSchema as unknown as { mainEntity: unknown[] }).mainEntity
    ).toHaveLength(2);
  });
});
