import { describe, expect, it } from 'vitest';
import type { Product } from './products';
import {
  generateCollectionPageSchema,
  generateProductSchema,
  getCanonicalStorefrontFilterSearchParams,
  getIndexableRobotsMetadata,
  hasFilterableQueryParams,
} from './seo-utils';

describe('seo-utils crawl-policy re-exports', () => {
  it('detects filterable query parameters including sort and graphicsHub', () => {
    expect(hasFilterableQueryParams()).toBe(false);
    expect(hasFilterableQueryParams({ brand: 'Dell' })).toBe(true);
    expect(hasFilterableQueryParams({ sort: 'price-asc' })).toBe(true);
    expect(hasFilterableQueryParams({ graphicsHub: 'rtx-4070' })).toBe(true);
  });

  it('drops canonical filter params until filters affect results', () => {
    expect(
      getCanonicalStorefrontFilterSearchParams({ brand: 'Dell' }).toString()
    ).toBe('');
    expect(
      getCanonicalStorefrontFilterSearchParams(
        { brand: 'Dell' },
        { filtersAffectResults: true }
      ).toString()
    ).toBe('brand=Dell');
  });

  it('omits graphicsHub token from canonical params and treats it as filter', () => {
    expect(
      getCanonicalStorefrontFilterSearchParams(
        { graphics: 'NVIDIA RTX 4070', graphicsHub: 'rtx-4070' },
        { filtersAffectResults: true }
      ).toString()
    ).toBe('');
  });

  it('noindexes sort, sortBy, order, and graphicsHub URLs', () => {
    for (const searchParams of [
      { sort: 'price-asc' },
      { sort: 'newest' },
      { sortBy: 'price' },
      { order: 'desc' },
      { graphicsHub: 'rtx-4070' },
    ]) {
      expect(hasFilterableQueryParams(searchParams)).toBe(true);
      expect(getIndexableRobotsMetadata(searchParams)).toMatchObject({
        index: false,
        follow: true,
        googleBot: { index: false, follow: true },
      });
      expect(
        getIndexableRobotsMetadata(searchParams, { filtersAffectResults: true })
      ).toMatchObject({
        index: false,
        follow: true,
        googleBot: { index: false, follow: true },
      });
    }
  });

  it('keeps single facet indexable when filters affect results and noindexes multi-filter', () => {
    expect(
      getIndexableRobotsMetadata(
        { brand: 'Dell' },
        { filtersAffectResults: true }
      )
    ).toMatchObject({
      index: true,
      follow: true,
    });

    expect(
      getIndexableRobotsMetadata(
        { brand: 'Dell', minPrice: '100000' },
        { filtersAffectResults: true }
      )
    ).toMatchObject({
      index: false,
      follow: true,
    });
  });
});

describe('generateProductSchema & generateCollectionPageSchema entity-ID bindings', () => {
  function makeSampleProduct(overrides: Partial<Product> = {}): Product {
    return {
      id: 'prod-123',
      name: 'iPhone 16 Pro',
      description: 'Flagship Apple smartphone.',
      price: 1500000,
      slug: 'iphone-16-pro',
      status: 'active',
      manage_stock: false,
      stock: 10,
      image: 'https://cdn.example.com/phone.jpg',
      imageLarge: 'https://cdn.example.com/phone-large.jpg',
      imageHint: 'iPhone 16 Pro',
      brand: 'Apple',
      gtin: '',
      mpn: '',
      ...overrides,
    };
  }

  const sampleProduct = makeSampleProduct();

  it('binds distinct tenant-scoped seller @id for path-based and custom-domain merchants', () => {
    const alphaSchema = generateProductSchema(
      sampleProduct,
      'Merchant Alpha',
      'NGN',
      'NG',
      undefined,
      undefined,
      {
        merchantBaseUrl: 'https://usebaci.com/merchant-alpha',
        productUrl: 'https://usebaci.com/merchant-alpha/products/iphone-16-pro',
      }
    );
    const betaSchema = generateProductSchema(
      sampleProduct,
      'Merchant Beta',
      'NGN',
      'NG',
      undefined,
      undefined,
      {
        merchantBaseUrl: 'https://usebaci.com/merchant-beta/',
        productUrl: 'https://usebaci.com/merchant-beta/products/iphone-16-pro',
      }
    );
    const ogabasseySchema = generateProductSchema(
      sampleProduct,
      'OgaBassey',
      'NGN',
      'NG',
      undefined,
      undefined,
      {
        merchantBaseUrl: 'https://ogabassey.com',
        productUrl: 'https://ogabassey.com/products/iphone-16-pro',
      }
    );

    const alphaOffer = alphaSchema.offers as Record<string, unknown>;
    const alphaSeller = alphaOffer.seller as Record<string, unknown>;
    expect(alphaSeller['@id']).toBe(
      'https://usebaci.com/merchant-alpha/#online-store'
    );

    const betaOffer = betaSchema.offers as Record<string, unknown>;
    const betaSeller = betaOffer.seller as Record<string, unknown>;
    expect(betaSeller['@id']).toBe(
      'https://usebaci.com/merchant-beta/#online-store'
    );

    const ogabasseyOffer = ogabasseySchema.offers as Record<string, unknown>;
    const ogabasseySeller = ogabasseyOffer.seller as Record<string, unknown>;
    expect(ogabasseySeller['@id']).toBe('https://ogabassey.com/#online-store');
  });

  it('omits seller @id when merchantBaseUrl is not provided or invalid', () => {
    const withoutBaseUrl = generateProductSchema(
      sampleProduct,
      'Merchant Alpha',
      'NGN',
      'NG',
      undefined,
      undefined,
      {
        productUrl: 'https://usebaci.com/merchant-alpha/products/iphone-16-pro',
      }
    );
    const invalidBaseUrl = generateProductSchema(
      sampleProduct,
      'Merchant Alpha',
      'NGN',
      'NG',
      undefined,
      undefined,
      {
        merchantBaseUrl: 'not-a-valid-url',
        productUrl: 'https://usebaci.com/merchant-alpha/products/iphone-16-pro',
      }
    );

    const offerWithout = withoutBaseUrl.offers as Record<string, unknown>;
    expect(offerWithout.seller).not.toHaveProperty('@id');

    const offerInvalid = invalidBaseUrl.offers as Record<string, unknown>;
    expect(offerInvalid.seller).not.toHaveProperty('@id');
  });

  it('binds seller @id on every offer in variant products when merchantBaseUrl is provided', () => {
    const variantProduct: Product = makeSampleProduct({
      variants: [
        {
          id: 'v-1',
          product_id: 'prod-123',
          merchant_id: 'm-1',
          price_override: 1550000,
          stock_quantity: 5,
          attributes: { Color: 'Natural Titanium' },
        },
        {
          id: 'v-2',
          product_id: 'prod-123',
          merchant_id: 'm-1',
          price_override: 1650000,
          stock_quantity: 3,
          attributes: { Color: 'Black Titanium' },
        },
      ],
    });

    const variantSchema = generateProductSchema(
      variantProduct,
      'Merchant Alpha',
      'NGN',
      'NG',
      undefined,
      undefined,
      {
        merchantBaseUrl: 'https://usebaci.com/merchant-alpha',
        productUrl: 'https://usebaci.com/merchant-alpha/products/iphone-16-pro',
      }
    );

    expect(variantSchema['@type']).toBe('ProductGroup');
    const hasVariant = variantSchema.hasVariant as Array<{
      offers: Record<string, unknown>;
    }>;
    expect(hasVariant).toHaveLength(2);
    for (const variant of hasVariant) {
      const seller = variant.offers.seller as Record<string, unknown>;
      expect(seller['@id']).toBe(
        'https://usebaci.com/merchant-alpha/#online-store'
      );
    }
  });

  it('emits product @id when productUrl is provided and normalizes trailing slashes', () => {
    const schema = generateProductSchema(
      sampleProduct,
      'OgaBassey',
      'NGN',
      'NG',
      undefined,
      undefined,
      {
        productUrl: 'https://ogabassey.com/products/iphone-16-pro',
      }
    );
    expect(schema['@id']).toBe(
      'https://ogabassey.com/products/iphone-16-pro#product'
    );

    const schemaWithSlash = generateProductSchema(
      sampleProduct,
      'OgaBassey',
      'NGN',
      'NG',
      undefined,
      undefined,
      {
        productUrl: 'https://ogabassey.com/products/iphone-16-pro/',
      }
    );
    expect(schemaWithSlash['@id']).toBe(
      'https://ogabassey.com/products/iphone-16-pro#product'
    );

    const schemaWithoutUrl = generateProductSchema(
      sampleProduct,
      'OgaBassey',
      'NGN',
      'NG'
    );
    expect(schemaWithoutUrl).not.toHaveProperty('@id');
  });

  it('emits collection @id in generateCollectionPageSchema when url is provided', () => {
    const schema = generateCollectionPageSchema({
      name: 'Smartphones',
      url: 'https://ogabassey.com/smartphones',
      merchantName: 'OgaBassey',
      currency: 'NGN',
      products: [sampleProduct],
    });
    expect(schema['@id']).toBe('https://ogabassey.com/smartphones#collection');

    const schemaWithSlash = generateCollectionPageSchema({
      name: 'Smartphones',
      url: 'https://ogabassey.com/smartphones/',
      merchantName: 'OgaBassey',
      currency: 'NGN',
      products: [sampleProduct],
    });
    expect(schemaWithSlash['@id']).toBe(
      'https://ogabassey.com/smartphones#collection'
    );

    const pathSchema = generateCollectionPageSchema({
      name: 'Smartphones',
      url: 'https://usebaci.com/merchant-alpha/smartphones',
      merchantName: 'Merchant Alpha',
      currency: 'NGN',
      products: [sampleProduct],
    });
    expect(pathSchema['@id']).toBe(
      'https://usebaci.com/merchant-alpha/smartphones#collection'
    );
  });
});
