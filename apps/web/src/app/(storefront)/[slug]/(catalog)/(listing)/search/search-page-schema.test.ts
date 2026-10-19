import { describe, expect, it } from 'vitest';
import type { NormalizedProduct } from '@/lib/normalize-product';
import { buildSearchPageSchemas } from './search-page-schema';

const products = [
  {
    id: 'product-1',
    name: 'iPhone 16',
    price: 1200000,
    slug: 'iphone-16',
    image: 'https://example.com/iphone.png',
  },
] as NormalizedProduct[];

describe('buildSearchPageSchemas', () => {
  it('builds page-aware collection markup with offset positions', () => {
    const { breadcrumbSchema, searchResultsSchema } = buildSearchPageSchemas({
      businessName: 'Ogabassey',
      merchantCurrency: 'NGN',
      page: 2,
      pageUrl: 'https://shop.example.ng/search?q=iphone&page=2',
      products,
      searchFailed: false,
      searchQuery: 'iphone',
      storeUrl: 'https://shop.example.ng',
      visibleCount: 1,
    });

    expect(breadcrumbSchema).toMatchObject({ '@type': 'BreadcrumbList' });
    expect(searchResultsSchema).toMatchObject({
      '@type': 'CollectionPage',
      url: 'https://shop.example.ng/search?q=iphone&page=2',
      numberOfItems: 1,
    });
    expect(searchResultsSchema.mainEntity.itemListElement[0]).toMatchObject({
      '@type': 'ListItem',
      position: 21,
    });
  });

  it('omits items when the search failed', () => {
    const { searchResultsSchema } = buildSearchPageSchemas({
      businessName: 'Ogabassey',
      merchantCurrency: 'NGN',
      page: 1,
      pageUrl: 'https://shop.example.ng/search?q=iphone',
      products,
      searchFailed: true,
      searchQuery: 'iphone',
      storeUrl: 'https://shop.example.ng',
      visibleCount: 0,
    });

    expect(searchResultsSchema.mainEntity.itemListElement).toEqual([]);
    expect(searchResultsSchema.numberOfItems).toBe(0);
  });
});
