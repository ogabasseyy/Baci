// src/lib/seo-utils.test.ts

import { describe, expect, it } from 'vitest';
import type { Product } from './products';
import { safeJsonLdStringify } from './sanitize-json-ld';
import {
  buildProductUrl,
  buildStorefrontAcceptedPaymentMethods,
  generateBlogPostSchema,
  generateBreadcrumbSchema,
  generateCollectionPageSchema,
  generateMetaTitle,
  generateOrganizationSchema,
  generateProductSchema,
  generateSlug,
  getEffectiveProductStock,
  getProductUrl,
  getValidatedProductUrl,
  isRedundantPlatformListParenthetical,
  stripRedundantPlatformParentheticals,
} from './seo-utils';
import { makeSeoProduct as makeProduct } from './seo-utils-product-schema-test-helper';
import type { MerchantTrustProfile } from './storefront-trust/merchant-trust-profile-types';

function makeTrustProfile(
  overrides: Partial<MerchantTrustProfile> = {}
): MerchantTrustProfile {
  return {
    socialLinks: {},
    derivedLinks: {},
    ...overrides,
  };
}

const completePolicies = makeTrustProfile({
  shippingPolicy: {
    localRoute: '/shipping',
    regions: ['NG'],
    shippingFeeType: 'free',
    handlingDaysMin: 0,
    handlingDaysMax: 1,
    transitDaysMin: 1,
    transitDaysMax: 5,
  },
  returnPolicy: {
    localRoute: '/returns',
    windowDays: 7,
    returnMethod: 'in_store',
    returnFees: 'free',
  },
});

describe('buildStorefrontAcceptedPaymentMethods', () => {
  it('derives only checkout-enabled payment methods for structured data', () => {
    const methods = buildStorefrontAcceptedPaymentMethods(
      {
        country: 'NG',
        paystack_subaccount_code: 'ACCT_test',
        feature_settings: {
          credit_direct_enabled: true,
          credpal_enabled: true,
          klump_enabled: false,
          pay_on_delivery_enabled: true,
          wallet_paystack_dva_enabled: true,
        },
      },
      {
        korapayConfigured: true,
        paystackConfigured: true,
        currency: 'NGN',
      }
    );

    expect(methods).toEqual([
      'Debit and credit card',
      'USSD',
      'Bank transfer',
      'Pay on delivery',
    ]);
  });

  it('does not claim Paystack methods when the storefront gate is disabled', () => {
    const methods = buildStorefrontAcceptedPaymentMethods(
      {
        country: 'NG',
        paystack_subaccount_code: 'ACCT_test',
        feature_settings: {
          paystack_enabled: false,
        },
      },
      {
        korapayConfigured: true,
        paystackConfigured: true,
        currency: 'NGN',
      }
    );

    expect(methods).toEqual([]);
  });

  it('does not advertise payment methods that need additional checkout eligibility checks', () => {
    const methods = buildStorefrontAcceptedPaymentMethods(
      {
        country: 'NG',
        paystack_subaccount_code: 'ACCT_test',
        feature_settings: {
          credit_direct_enabled: true,
          credpal_enabled: true,
          juicyway_enabled: true,
          korapay_enabled: true,
          klump_enabled: true,
        },
      },
      {
        korapayConfigured: false,
        paystackConfigured: true,
        currency: 'NGN',
      }
    );

    expect(methods).toEqual(['Debit and credit card', 'USSD']);
  });

  it('omits Paystack-backed methods when Paystack is not configured', () => {
    const methods = buildStorefrontAcceptedPaymentMethods(
      {
        country: 'NG',
        paystack_subaccount_code: 'ACCT_test',
        feature_settings: {
          korapay_enabled: true,
        },
      },
      {
        korapayConfigured: true,
        paystackConfigured: false,
        currency: 'GHS',
      }
    );

    expect(methods).toEqual(['Debit and credit card']);
  });

  it('omits Paystack-backed methods when the offer currency is not NGN', () => {
    const methods = buildStorefrontAcceptedPaymentMethods(
      {
        country: 'NG',
        paystack_subaccount_code: 'ACCT_test',
      },
      {
        korapayConfigured: false,
        paystackConfigured: true,
        currency: 'GHS',
      }
    );

    expect(methods).toEqual([]);
  });

  it('omits Korapay cards when Korapay is not configured', () => {
    const methods = buildStorefrontAcceptedPaymentMethods(
      {
        country: 'GH',
        feature_settings: {
          korapay_enabled: true,
        },
      },
      {
        korapayConfigured: false,
        paystackConfigured: true,
        currency: 'GHS',
      }
    );

    expect(methods).toEqual([]);
  });

  it('omits Korapay cards when the storefront currency is unsupported', () => {
    const methods = buildStorefrontAcceptedPaymentMethods(
      {
        country: 'IN',
        feature_settings: {
          korapay_enabled: true,
        },
      },
      {
        korapayConfigured: true,
        paystackConfigured: false,
        currency: 'INR',
      }
    );

    expect(methods).toEqual([]);
  });
});

describe('generateProductSchema - ProductGroup for variant products', () => {
  it('outputs @type Product when no variants', () => {
    const product = makeProduct();
    const schema = generateProductSchema(product, 'TestStore', 'USD', 'NG');

    expect(schema['@type']).toBe('Product');
    expect(schema.productGroupID).toBeUndefined();
    expect(schema.hasVariant).toBeUndefined();
    expect(schema.variesBy).toBeUndefined();
  });

  it('does not emit non-schema google_product_category on Product markup', () => {
    const product = makeProduct({
      google_product_category:
        'Electronics > Communications > Telephony > Mobile Phones',
    });
    const schema = generateProductSchema(product, 'TestStore', 'USD', 'NG');

    expect(schema).not.toHaveProperty('google_product_category');
  });

  it('outputs @type ProductGroup when variants exist', () => {
    const product = makeProduct({
      slug: 'test-product',
      has_variants: true,
      variants: [
        {
          id: 'v1',
          product_id: 'test-123',
          merchant_id: 'm1',
          attributes: { storage: '128GB' },
          price_override: 90,
          stock_quantity: 5,
        },
        {
          id: 'v2',
          product_id: 'test-123',
          merchant_id: 'm1',
          attributes: { storage: '256GB' },
          price_override: 120,
          stock_quantity: 3,
        },
      ],
    });

    const schema = generateProductSchema(product, 'TestStore', 'USD', 'NG');

    expect(schema['@type']).toBe('ProductGroup');
    expect(schema.productGroupID).toBe('test-product');
  });

  it('keeps variant products as complete merchant listing offers without AggregateOffer', () => {
    const product = makeProduct({
      slug: 'test-product',
      variants: [
        {
          id: 'v1',
          product_id: 'test-123',
          merchant_id: 'm1',
          attributes: { storage: '128GB' },
          price_override: 50,
          stock_quantity: 5,
        },
        {
          id: 'v2',
          product_id: 'test-123',
          merchant_id: 'm1',
          attributes: { storage: '256GB' },
          price_override: 200,
          stock_quantity: 3,
        },
      ],
    });

    const schema = generateProductSchema(
      product,
      'TestStore',
      'NGN',
      'NG',
      undefined,
      undefined,
      {
        productUrl: 'https://ogabassey.com/gaming/test-product',
      }
    );
    const variants = schema.hasVariant as Record<string, unknown>[];
    const firstVariant = variants[0] as Record<string, unknown>;
    const firstOffer = firstVariant.offers as Record<string, unknown>;

    expect(schema['@type']).toBe('ProductGroup');
    expect(schema.offers).toBeUndefined();
    expect(schema.url).toBe('https://ogabassey.com/gaming/test-product');
    expect(firstVariant.inProductGroupWithID).toBe('test-product');
    expect(firstVariant.url).toBe(
      'https://ogabassey.com/gaming/test-product?variantId=v1'
    );
    expect(firstOffer['@type']).toBe('Offer');
    expect(firstOffer.price).toBe(50);
    expect(firstOffer.priceCurrency).toBe('NGN');
    expect(firstOffer.availability).toBe('https://schema.org/InStock');
    expect(firstOffer.itemCondition).toBe('https://schema.org/NewCondition');
    expect(firstOffer.url).toBe(
      'https://ogabassey.com/gaming/test-product?variantId=v1'
    );
  });

  it('builds stable variantId URLs with decoded round-trip semantics', () => {
    const variantId = 'variant 1';
    const schema = generateProductSchema(
      makeProduct({
        slug: 'pixel-10',
        variants: [
          {
            id: variantId,
            product_id: 'test-123',
            merchant_id: 'm1',
            condition: 'refurbished',
            attributes: {
              storage: '256 GB',
              color: 'Obsidian Black',
            },
            price_override: 500000,
            stock_quantity: 3,
          },
        ],
      }),
      'TestStore',
      'NGN',
      'NG',
      undefined,
      undefined,
      {
        productUrl: 'https://ogabassey.com/smartphones/pixel-10?source=web',
      }
    );

    const variants = schema.hasVariant as Record<string, unknown>[];
    const variant = variants[0] as Record<string, unknown>;
    const offer = variant.offers as Record<string, unknown>;

    expect(new URL(String(variant.url)).searchParams.get('variantId')).toBe(
      variantId
    );
    expect(new URL(String(offer.url)).searchParams.get('variantId')).toBe(
      variantId
    );
    expect(offer.url).toBe(variant.url);
  });

  it('round-trips variantId URLs with reserved characters', () => {
    const variantId = 'a&b';
    const schema = generateProductSchema(
      makeProduct({
        slug: 'pixel-10',
        variants: [
          {
            id: variantId,
            product_id: 'test-123',
            merchant_id: 'm1',
            attributes: {
              storage: '512 GB',
              color: 'Porcelain',
            },
            price_override: 600000,
            stock_quantity: 2,
          },
        ],
      }),
      'TestStore',
      'NGN',
      'NG',
      undefined,
      undefined,
      {
        productUrl: 'https://ogabassey.com/smartphones/pixel-10?source=web',
      }
    );

    const variants = schema.hasVariant as Record<string, unknown>[];
    const variant = variants[0] as Record<string, unknown>;
    const offer = variant.offers as Record<string, unknown>;

    expect(new URL(String(variant.url)).searchParams.get('variantId')).toBe(
      variantId
    );
    expect(new URL(String(offer.url)).searchParams.get('variantId')).toBe(
      variantId
    );
    expect(offer.url).toBe(variant.url);
  });

  it('omits structured-data URLs when productUrl uses an unsupported scheme', () => {
    const schema = generateProductSchema(
      makeProduct({
        slug: 'test-product',
        variants: [
          {
            id: 'v1',
            product_id: 'test-123',
            merchant_id: 'm1',
            attributes: { storage: '128GB' },
            stock_quantity: 5,
          },
        ],
      }),
      'TestStore',
      'NGN',
      'NG',
      undefined,
      undefined,
      {
        productUrl: 'mailto:support@example.com',
      }
    );
    const variants = schema.hasVariant as Record<string, unknown>[];
    const variant = variants[0] as Record<string, unknown>;
    const offer = variant.offers as Record<string, unknown>;

    expect(schema.url).toBeUndefined();
    expect(variant.url).toBeUndefined();
    expect(offer.url).toBeUndefined();
  });

  it('omits structured-data URLs when productUrl uses a javascript scheme', () => {
    const schema = generateProductSchema(
      makeProduct({
        slug: 'test-product',
        variants: [
          {
            id: 'v1',
            product_id: 'test-123',
            merchant_id: 'm1',
            attributes: { storage: '128GB' },
            stock_quantity: 5,
          },
        ],
      }),
      'TestStore',
      'NGN',
      'NG',
      undefined,
      undefined,
      {
        productUrl: 'javascript:alert(1)',
      }
    );
    const variants = schema.hasVariant as Record<string, unknown>[];
    const variant = variants[0] as Record<string, unknown>;
    const offer = variant.offers as Record<string, unknown>;

    expect(schema.url).toBeUndefined();
    expect(variant.url).toBeUndefined();
    expect(offer.url).toBeUndefined();
  });

  it('puts correct Offer on each hasVariant entry with fallback to parent price', () => {
    const product = makeProduct({
      price: 100,
      variants: [
        {
          id: 'v1',
          product_id: 'test-123',
          merchant_id: 'm1',
          attributes: { storage: '128GB' },
          stock_quantity: 5,
        },
        {
          id: 'v2',
          product_id: 'test-123',
          merchant_id: 'm1',
          attributes: { storage: '256GB' },
          price_override: 150,
          stock_quantity: 3,
        },
      ],
    });

    const schema = generateProductSchema(product, 'TestStore', 'USD', 'NG');
    const variants = schema.hasVariant as Record<string, unknown>[];
    const v1Offer = variants[0].offers as Record<string, unknown>;
    const v2Offer = variants[1].offers as Record<string, unknown>;

    expect(v1Offer['@type']).toBe('Offer');
    expect(v1Offer.price).toBe(100); // Falls back to parent price
    expect(v1Offer.priceCurrency).toBe('USD');

    expect(v2Offer['@type']).toBe('Offer');
    expect(v2Offer.price).toBe(150); // Uses price_override
  });

  it('includes hasVariant array with correct variant names', () => {
    const product = makeProduct({
      variants: [
        {
          id: 'v1',
          product_id: 'test-123',
          merchant_id: 'm1',
          attributes: { storage: '128GB', ram: '8GB' },
          price_override: 90,
          stock_quantity: 5,
        },
      ],
    });

    const schema = generateProductSchema(product, 'TestStore', 'USD', 'NG');
    const variants = schema.hasVariant as Record<string, unknown>[];

    expect(variants).toHaveLength(1);
    expect(variants[0]['@type']).toBe('Product');
    expect(variants[0].name).toBe('Test Product - 128GB / 8GB');
    expect(variants[0].sku).toBe('v1');
  });

  it('keeps group identifiers on the parent and omits them from identifier-free variant nodes', () => {
    const product = makeProduct({
      description: 'A flagship device with variant-specific merchandising.',
      brand: 'Samsung',
      gtin: '1234567890123',
      mpn: 'SM-S25-256-JB',
      variants: [
        {
          id: 'v1',
          product_id: 'test-123',
          merchant_id: 'm1',
          attributes: {
            color: 'Titanium Jetblack',
            storage: '256GB',
            ram: '12GB',
          },
          stock_quantity: 5,
        },
      ],
    });

    const schema = generateProductSchema(product, 'TestStore', 'USD', 'NG');
    const variants = schema.hasVariant as Record<string, unknown>[];

    expect(schema.brand).toEqual({
      '@type': 'Brand',
      name: 'Samsung',
    });
    expect(variants[0]).not.toHaveProperty('brand');
    expect(schema.gtin).toBe('1234567890123');
    expect(schema.mpn).toBe('SM-S25-256-JB');
    expect(variants[0]).not.toHaveProperty('gtin');
    expect(variants[0]).not.toHaveProperty('mpn');
    expect(schema.description).toBe(
      'A flagship device with variant-specific merchandising.'
    );
    expect(variants[0]?.description).toContain(
      'A flagship device with variant-specific merchandising.'
    );
    expect(variants[0]?.color).toBe('Titanium Jetblack');
    expect(variants[0]?.size).toBe('256GB / 12GB');
  });

  it('omits color and size when variant attributes do not provide them', () => {
    const product = makeProduct({
      variants: [
        {
          id: 'v1',
          product_id: 'test-123',
          merchant_id: 'm1',
          attributes: { processor: 'Snapdragon 8 Elite' },
          stock_quantity: 5,
        },
      ],
    });

    const schema = generateProductSchema(product, 'TestStore', 'USD', 'NG');
    const variants = schema.hasVariant as Record<string, unknown>[];

    expect(variants[0]).not.toHaveProperty('color');
    expect(variants[0]).not.toHaveProperty('size');
  });

  it('computes variesBy with deduplication and excludes unsupported keys', () => {
    const product = makeProduct({
      variants: [
        {
          id: 'v1',
          product_id: 'test-123',
          merchant_id: 'm1',
          attributes: {
            storage: '128GB',
            ram: '8GB',
            color: 'Black',
            processor: 'M3',
          },
          stock_quantity: 5,
        },
        {
          id: 'v2',
          product_id: 'test-123',
          merchant_id: 'm1',
          attributes: {
            storage: '256GB',
            ram: '16GB',
            color: 'White',
            processor: 'M3 Pro',
          },
          stock_quantity: 3,
        },
      ],
    });

    const schema = generateProductSchema(product, 'TestStore', 'USD', 'NG');
    const variesBy = schema.variesBy as string[];

    // storage and ram both map to schema.org/size — should be deduplicated
    expect(variesBy).toContain('https://schema.org/size');
    expect(variesBy).toContain('https://schema.org/color');
    // 'processor' is not a Google-supported variesBy value — excluded
    expect(variesBy).not.toContain('https://schema.org/additionalProperty');
    // Exactly 2 unique values: size + color
    expect(variesBy).toHaveLength(2);
  });

  describe('bugfix: product structured data variant and policy regressions', () => {
    it('declares only variant dimensions present on every variant', () => {
      const schema = generateProductSchema(
        makeProduct({
          variants: [
            {
              id: 'v1',
              product_id: 'test-123',
              merchant_id: 'm1',
              attributes: { color: 'Silver', storage: '512GB' },
              stock_quantity: 2,
            },
            {
              id: 'v2',
              product_id: 'test-123',
              merchant_id: 'm1',
              attributes: { ram: '16GB' },
              stock_quantity: 2,
            },
            {
              id: 'v3',
              product_id: 'test-123',
              merchant_id: 'm1',
              attributes: { color: 'Black' },
              stock_quantity: 2,
            },
          ],
        }),
        'TestStore',
        'NGN',
        'NG'
      );
      expect(schema.variesBy).toBeUndefined();
      const variants = schema.hasVariant as Record<string, unknown>[];
      expect(variants[0].color).toBe('Silver');
      expect(variants[1]).not.toHaveProperty('color');
      expect(variants[2]).not.toHaveProperty('size');
    });

    it.each([
      [{ color: 'Black', size: '128GB' }, { color: 'White' }, 'color'],
      [{ color: 'Black', size: '128GB' }, { size: '256GB' }, 'size'],
    ] as const)('emits the independently complete variant dimension', (first, second, expected) => {
      const schema = generateProductSchema(
        makeProduct({
          variants: [
            {
              id: 'v1',
              product_id: 'test-123',
              merchant_id: 'm1',
              stock_quantity: 2,
              attributes: first,
            },
            {
              id: 'v2',
              product_id: 'test-123',
              merchant_id: 'm1',
              stock_quantity: 2,
              attributes: second,
            },
          ],
        }),
        'TestStore',
        'NGN',
        'NG'
      );
      expect(schema.variesBy).toEqual([`https://schema.org/${expected}`]);
    });

    it('provides a truthful description on each product variant', () => {
      const schema = generateProductSchema(
        makeProduct({
          description: 'A refurbished phone with a clear display.',
          variants: [
            {
              id: 'v1',
              product_id: 'test-123',
              merchant_id: 'm1',
              attributes: { color: 'Black', storage: '128GB' },
              stock_quantity: 2,
            },
          ],
        }),
        'TestStore',
        'NGN',
        'NG'
      );
      const variant = (schema.hasVariant as Record<string, unknown>[])[0];
      expect(variant.description).toContain(
        'A refurbished phone with a clear display.'
      );
      expect(variant.description).toContain('Black');
      expect(variant.description).toContain('128GB');
    });

    it('keeps variant names concise when catalog attributes contain long specifications', () => {
      const schema = generateProductSchema(
        makeProduct({
          name: 'HP ProBook 440 G11',
          variants: [
            {
              id: 'v1',
              product_id: 'test-123',
              merchant_id: 'm1',
              attributes: {
                color: 'Pike Silver',
                ram: '16GB',
                processor: 'Core Ultra 5',
                specifications: 'detailed specification '.repeat(30),
              },
              stock_quantity: 2,
            },
          ],
        }),
        'TestStore',
        'NGN',
        'NG'
      );
      const name = String(
        (schema.hasVariant as Record<string, unknown>[])[0].name
      );
      expect(name.length).toBeLessThanOrEqual(150);
      expect(name).toContain('HP ProBook 440 G11');
      expect(name).toContain('Pike Silver');
      expect(name).toContain('16GB');
    });

    it('uses stable feed identifiers when a variant SKU or group slug is invalid', () => {
      const schema = generateProductSchema(
        makeProduct({
          id: 'e7d13d26-ef38-4c5b-a616-40d23cf69708',
          slug: `product-${'x'.repeat(60)}`,
          variants: [
            {
              id: 'b9c67d32-7d63-41a3-9b14-2e7eb322a995',
              product_id: 'test-123',
              merchant_id: 'm1',
              sku: `INVALID SKU ${'x'.repeat(60)}`,
              attributes: { color: 'Black' },
              stock_quantity: 2,
            },
          ],
        }),
        'TestStore',
        'NGN',
        'NG'
      );
      const variant = (schema.hasVariant as Record<string, unknown>[])[0];
      expect(schema.productGroupID).toBe(
        'e7d13d26-ef38-4c5b-a616-40d23cf69708'
      );
      expect(variant.inProductGroupWithID).toBe(schema.productGroupID);
      expect(variant.sku).toBe('b9c67d32-7d63-41a3-9b14-2e7eb322a995');
    });

    it('preserves validated SKU fallback and clears stale custom variesBy when custom schema markup is invalid or incomplete', () => {
      const singleSchema = generateProductSchema(
        makeProduct({
          id: 'e7d13d26-ef38-4c5b-a616-40d23cf69708',
          sku: `INVALID SKU ${'x'.repeat(60)}`,
          schema_markup: {
            sku: `CUSTOM INVALID SKU ${'y'.repeat(60)}`,
          } as unknown as Product['schema_markup'],
        }),
        'TestStore',
        'NGN',
        'NG'
      );
      expect(singleSchema.sku).toBe('e7d13d26-ef38-4c5b-a616-40d23cf69708');

      const groupSchema = generateProductSchema(
        makeProduct({
          id: 'invalid id / with spaces',
          slug: `product-${'x'.repeat(60)}`,
          schema_markup: {
            variesBy: ['https://schema.org/color'],
          } as unknown as Product['schema_markup'],
          variants: [
            {
              id: 'v1',
              product_id: 'test-123',
              merchant_id: 'm1',
              attributes: { color: 'Black' },
              stock_quantity: 2,
            },
            {
              id: 'v2',
              product_id: 'test-123',
              merchant_id: 'm1',
              attributes: { processor: 'M4' },
              stock_quantity: 2,
            },
          ],
        }),
        'TestStore',
        'NGN',
        'NG'
      );
      expect(groupSchema.variesBy).toBeUndefined();
      expect(groupSchema.productGroupID).toBe('group-invalid-id---with-spaces');
      expect(
        (groupSchema.hasVariant as Record<string, unknown>[])[0]
          .inProductGroupWithID
      ).toBe(groupSchema.productGroupID);
    });

    it('does not treat oversized specification text as a variant size', () => {
      const schema = generateProductSchema(
        makeProduct({
          variants: [
            {
              id: 'v1',
              product_id: 'test-123',
              merchant_id: 'm1',
              attributes: {
                storage: 'Full product specification '.repeat(10),
                ram: '32GB RAM',
              },
              stock_quantity: 2,
            },
          ],
        }),
        'TestStore',
        'NGN',
        'NG'
      );
      expect((schema.hasVariant as Record<string, unknown>[])[0].size).toBe(
        '32GB RAM'
      );
    });

    it('does not claim free nationwide shipping or return terms without evidence', () => {
      const schema = generateProductSchema(
        makeProduct({
          variants: [
            {
              id: 'v1',
              product_id: 'test-123',
              merchant_id: 'm1',
              attributes: { color: 'Black' },
              stock_quantity: 2,
            },
            {
              id: 'v2',
              product_id: 'test-123',
              merchant_id: 'm1',
              attributes: { color: 'White' },
              stock_quantity: 2,
            },
          ],
        }),
        'TestStore',
        'NGN',
        'NG',
        undefined,
        makeTrustProfile({
          shippingPolicy: {
            localRoute: '/shipping',
            regions: ['Lagos, Nigeria'],
            shippingFeeType: 'calculated',
          },
        })
      );
      for (const variant of schema.hasVariant as Record<string, unknown>[]) {
        const offer = variant.offers as Record<string, unknown>;
        expect(offer).not.toHaveProperty('shippingDetails');
        expect(offer).not.toHaveProperty('hasMerchantReturnPolicy');
      }
    });
  });

  it('sets variant-level availability correctly', () => {
    const product = makeProduct({
      variants: [
        {
          id: 'v1',
          product_id: 'test-123',
          merchant_id: 'm1',
          attributes: { storage: '128GB' },
          stock_quantity: 0,
        },
        {
          id: 'v2',
          product_id: 'test-123',
          merchant_id: 'm1',
          attributes: { storage: '256GB' },
          stock_quantity: 5,
        },
      ],
    });

    const schema = generateProductSchema(product, 'TestStore', 'USD', 'NG');
    const variants = schema.hasVariant as Record<string, unknown>[];

    const v1Offer = variants[0].offers as Record<string, unknown>;
    const v2Offer = variants[1].offers as Record<string, unknown>;

    expect(v1Offer.availability).toBe('https://schema.org/OutOfStock');
    expect(v2Offer.availability).toBe('https://schema.org/InStock');
  });

  it('includes variant-level images with fallback to parent images', () => {
    const product = makeProduct({
      images: [
        { url: 'https://cdn.example.com/parent.avif', alt: 'Parent', order: 0 },
      ],
      variants: [
        {
          id: 'v1',
          product_id: 'test-123',
          merchant_id: 'm1',
          attributes: { color: 'Black' },
          images: ['https://cdn.example.com/black.avif'],
          stock_quantity: 5,
        },
        {
          id: 'v2',
          product_id: 'test-123',
          merchant_id: 'm1',
          attributes: { color: 'White' },
          stock_quantity: 3,
          // No variant images — should fall back to parent
        },
      ],
    });

    const schema = generateProductSchema(product, 'TestStore', 'USD', 'NG');
    const variants = schema.hasVariant as Record<string, unknown>[];

    // v1 has its own images
    expect(variants[0].image).toEqual(['https://cdn.example.com/black.avif']);
    // v2 falls back to parent images
    expect(variants[1].image).toEqual(['https://cdn.example.com/parent.avif']);
  });

  it('includes shippingDetails and returnPolicy on variant Offers (2026 best practice)', () => {
    const product = makeProduct({
      variants: [
        {
          id: 'v1',
          product_id: 'test-123',
          merchant_id: 'm1',
          attributes: { storage: '128GB' },
          stock_quantity: 5,
        },
      ],
    });

    const schema = generateProductSchema(
      product,
      'TestStore',
      'NGN',
      'NG',
      undefined,
      completePolicies
    );
    const variants = schema.hasVariant as Record<string, unknown>[];
    const offer = variants[0].offers as Record<string, unknown>;

    // The catalog does not provide a real expiry for this price.
    expect(offer).not.toHaveProperty('priceValidUntil');

    // shippingDetails
    const shipping = offer.shippingDetails as Record<string, unknown>;
    expect(shipping['@type']).toBe('OfferShippingDetails');
    const dest = shipping.shippingDestination as Record<string, unknown>;
    expect(dest.addressCountry).toBe('NG');

    // returnPolicy
    const returnPolicy = offer.hasMerchantReturnPolicy as Record<
      string,
      unknown
    >;
    expect(returnPolicy['@type']).toBe('MerchantReturnPolicy');
    expect(returnPolicy.applicableCountry).toBe('NG');
    expect(returnPolicy.returnPolicyCountry).toBe('NG');
    expect(returnPolicy.merchantReturnDays).toBe(7);
  });

  it('defines shared offer policies once and references them from later variants', () => {
    const product = makeProduct({
      variants: [1, 2, 3].map((n) => ({
        id: `v${n}`,
        product_id: 'test-123',
        merchant_id: 'm1',
        attributes: { storage: `${n * 128}GB` },
        stock_quantity: 5,
      })),
    });

    const schema = generateProductSchema(
      product,
      'TestStore',
      'NGN',
      'NG',
      undefined,
      completePolicies,
      { productUrl: 'https://shop.example/phones/test-product' }
    );
    const offers = (schema.hasVariant as Record<string, unknown>[]).map(
      (variant) => variant.offers as Record<string, unknown>
    );

    expect(offers[0]?.shippingDetails).toMatchObject({
      '@id': 'https://shop.example/phones/test-product#shipping-policy',
      '@type': 'OfferShippingDetails',
    });
    expect(offers[0]?.hasMerchantReturnPolicy).toMatchObject({
      '@id': 'https://shop.example/phones/test-product#return-policy',
      '@type': 'MerchantReturnPolicy',
    });
    for (const offer of offers.slice(1)) {
      expect(offer.shippingDetails).toEqual({
        '@id': 'https://shop.example/phones/test-product#shipping-policy',
      });
      expect(offer.hasMerchantReturnPolicy).toEqual({
        '@id': 'https://shop.example/phones/test-product#return-policy',
      });
    }
  });

  it('uses structured trust profile shipping and return settings instead of hardcoded defaults', () => {
    const schema = generateProductSchema(
      makeProduct({
        variants: [
          {
            id: 'v1',
            product_id: 'test-123',
            merchant_id: 'm1',
            attributes: { storage: '128GB' },
            stock_quantity: 5,
          },
        ],
      }),
      'TestStore',
      'NGN',
      'NG',
      undefined,
      makeTrustProfile({
        returnPolicy: {
          summary: 'Returns accepted within 14 days.',
          windowDays: 14,
          returnMethod: 'mail',
          returnFees: 'customer_pays',
          localRoute: '/returns',
        },
        shippingPolicy: {
          summary: 'Ships across Nigeria.',
          regions: ['NG'],
          handlingDaysMin: 2,
          handlingDaysMax: 4,
          transitDaysMin: 6,
          transitDaysMax: 8,
          shippingFeeType: 'free',
          localRoute: '/shipping',
        },
      })
    );

    const offer = (schema.hasVariant as Record<string, unknown>[])[0]
      .offers as Record<string, unknown>;
    const shipping = offer.shippingDetails as Record<string, unknown>;
    const returnPolicy = offer.hasMerchantReturnPolicy as Record<
      string,
      unknown
    >;
    const deliveryTime = shipping.deliveryTime as Record<string, unknown>;
    const handlingTime = deliveryTime.handlingTime as Record<string, unknown>;
    const transitTime = deliveryTime.transitTime as Record<string, unknown>;

    expect(handlingTime.minValue).toBe(2);
    expect(handlingTime.maxValue).toBe(4);
    expect(transitTime.minValue).toBe(6);
    expect(transitTime.maxValue).toBe(8);
    expect(returnPolicy.merchantReturnDays).toBe(14);
    expect(returnPolicy.returnMethod).toBe('https://schema.org/ReturnByMail');
    expect(returnPolicy.returnFees).toBe(
      'https://schema.org/ReturnShippingFees'
    );
  });

  it('strips HTML tags from structured product descriptions', () => {
    const schema = generateProductSchema(
      makeProduct({
        description:
          '<p>The <strong>best</strong> gaming laptop for creators.</p>',
      }),
      'TestStore',
      'USD',
      'NG'
    );

    expect(schema.description).toBe('The best gaming laptop for creators.');
  });

  it('removes stale absolute listed-price sentences from structured product descriptions', () => {
    const schema = generateProductSchema(
      makeProduct({
        description:
          'Premium foldable phone. Current listed price is NGN 2,500,000. Confirm selected variant price before checkout.',
      }),
      'TestStore',
      'NGN',
      'NG'
    );

    expect(schema.description).toBe(
      'Premium foldable phone. Confirm selected variant price before checkout.'
    );
  });

  it('does not let custom schema markup reintroduce stale listed prices or empty aggregate ratings', () => {
    const schema = generateProductSchema(
      makeProduct({
        description: 'Premium foldable phone.',
        schema_markup: {
          '@context': 'https://schema.org',
          '@type': 'Product',
          description:
            'Premium foldable phone. Current listed price is NGN 2,500,000.',
          aggregateRating: {
            '@type': 'AggregateRating',
            ratingValue: 5,
            reviewCount: 0,
          },
        },
      }),
      'TestStore',
      'NGN',
      'NG'
    );

    expect(schema.description).toBe('Premium foldable phone.');
    expect(schema.aggregateRating).toBeUndefined();
  });

  it('keeps custom aggregate ratings when ratingCount is positive and reviewCount is zero', () => {
    const schema = generateProductSchema(
      makeProduct({
        schema_markup: {
          '@context': 'https://schema.org',
          '@type': 'Product',
          aggregateRating: {
            '@type': 'AggregateRating',
            ratingValue: 4.5,
            reviewCount: 0,
            ratingCount: 12,
          },
        },
      }),
      'TestStore',
      'NGN',
      'NG'
    );

    expect(schema.aggregateRating).toEqual({
      '@type': 'AggregateRating',
      ratingValue: 4.5,
      reviewCount: 0,
      ratingCount: 12,
    });
  });

  it('removes custom aggregate ratings with rating values outside the declared scale', () => {
    const schema = generateProductSchema(
      makeProduct({
        schema_markup: {
          '@context': 'https://schema.org',
          '@type': 'Product',
          aggregateRating: {
            '@type': 'AggregateRating',
            ratingValue: 7,
            reviewCount: 2,
          },
        },
      }),
      'TestStore',
      'NGN',
      'NG'
    );

    expect(schema.aggregateRating).toBeUndefined();
  });

  it('removes custom aggregate ratings that use a non-storefront rating scale', () => {
    const schema = generateProductSchema(
      makeProduct({
        schema_markup: {
          '@context': 'https://schema.org',
          '@type': 'Product',
          aggregateRating: {
            '@type': 'AggregateRating',
            bestRating: 100,
            worstRating: 0,
            ratingValue: 87,
            ratingCount: 12,
          },
        },
      }),
      'TestStore',
      'NGN',
      'NG'
    );

    expect(schema.aggregateRating).toBeUndefined();
  });

  it('ignores non-object custom schema markup without throwing', () => {
    expect(() =>
      generateProductSchema(
        makeProduct({
          schema_markup:
            'invalid schema markup' as unknown as Product['schema_markup'],
        }),
        'TestStore',
        'NGN',
        'NG'
      )
    ).not.toThrow();

    const schema = generateProductSchema(
      makeProduct({
        schema_markup: [
          {
            '@type': 'Product',
            aggregateRating: {
              '@type': 'AggregateRating',
              ratingValue: 5,
              reviewCount: 2,
            },
          },
        ] as unknown as Product['schema_markup'],
      }),
      'TestStore',
      'NGN',
      'NG'
    );

    expect(schema.aggregateRating).toBeUndefined();
  });

  it('does not mutate merchant-provided custom schema markup or override live description', () => {
    const schemaMarkup = {
      '@context': 'https://schema.org',
      '@type': 'Product',
      description:
        'Premium foldable phone. Current listed price is NGN 2,500,000.',
      aggregateRating: {
        '@type': 'AggregateRating',
        ratingValue: 5,
        reviewCount: 0,
      },
    };

    const schema = generateProductSchema(
      makeProduct({
        schema_markup: schemaMarkup as Product['schema_markup'],
      }),
      'TestStore',
      'NGN',
      'NG'
    );

    expect(schema.description).toBe('A test product');
    expect(schema.aggregateRating).toBeUndefined();
    expect(schemaMarkup.description).toBe(
      'Premium foldable phone. Current listed price is NGN 2,500,000.'
    );
    expect(schemaMarkup.aggregateRating).toEqual({
      '@type': 'AggregateRating',
      ratingValue: 5,
      reviewCount: 0,
    });
  });

  it('serializes product schema without double-escaping text or URL data', () => {
    const imageUrl =
      'https://cdn.example.com/products/pro.png?fit=cover&width=600';
    const schema = generateProductSchema(
      makeProduct({
        name: 'AT&T <Pro>',
        brand: 'B&O',
        description: 'Premium & reliable.',
        imageLarge: imageUrl,
      }),
      'Baci & Co',
      'USD',
      'NG',
      undefined,
      undefined,
      {
        productUrl: 'https://store.example.com/products/at-t-pro?source=web',
      }
    );

    const serialized = safeJsonLdStringify(schema);
    const parsed = JSON.parse(serialized) as Record<string, unknown>;
    const brand = parsed.brand as Record<string, unknown>;
    const offers = parsed.offers as Record<string, unknown>;
    const seller = offers.seller as Record<string, unknown>;

    expect(serialized).toContain('\\u003c');
    expect(serialized).toContain('\\u0026');
    expect(parsed.name).toBe('AT&T <Pro>');
    expect(parsed.description).toBe('Premium & reliable.');
    expect(parsed.url).toBe(
      'https://store.example.com/products/at-t-pro?source=web'
    );
    expect(parsed.image).toEqual([imageUrl]);
    expect(brand.name).toBe('B&O');
    expect(seller.name).toBe('Baci & Co');
  });

  it('keeps product descriptions parseable when a surrogate is truncated', () => {
    const schema = generateProductSchema(
      makeProduct({
        description: `broken ${String.fromCharCode(0xd83e)}...`,
      })
    );

    expect(JSON.parse(safeJsonLdStringify(schema))).toMatchObject({
      description: 'broken �...',
    });
  });
});

describe('generateOrganizationSchema', () => {
  it('does not invent a return window or fees from a summary-only policy', () => {
    const schema = generateOrganizationSchema({
      name: 'Test Store',
      url: 'https://test.example',
      trustProfile: makeTrustProfile({
        returnPolicy: {
          summary: 'Contact us about returns',
          localRoute: '/returns',
        },
      }),
    });
    expect(schema).not.toHaveProperty('hasMerchantReturnPolicy');
  });
  it('keeps controlled use-brand profiles for the platform organization', () => {
    const schema = generateOrganizationSchema({
      name: 'Baci',
      url: 'https://baci.app',
      country: 'NG',
      socialMedia: {
        instagram: 'usebaci',
        linkedin: 'usebaci',
        twitter: 'usebaci',
      },
    });

    expect(schema.sameAs).toEqual([
      'https://instagram.com/usebaci',
      'https://x.com/usebaci',
      'https://linkedin.com/company/usebaci',
    ]);
  });

  it('omits sameAs profiles whose handles do not match the organization brand', () => {
    const schema = generateOrganizationSchema({
      name: 'Ogabassey',
      url: 'https://ogabassey.com',
      country: 'NG',
      socialMedia: {
        youtube: 'ogabassey',
        linkedin: 'ogabasseyy',
        instagram: 'ywzhqv',
        twitter: 'sxgtow',
        facebook: 'odvkrk',
      },
    });

    expect(schema.sameAs).toEqual([
      'https://linkedin.com/company/ogabasseyy',
      'https://youtube.com/@ogabassey',
    ]);
  });

  it('adds normalized sameAs, contactPoint, foundingDate, and return policy from the trust profile', () => {
    const schema = generateOrganizationSchema({
      name: 'Test Store',
      url: 'https://test.example',
      country: 'NG',
      logo: 'https://cdn.example.com/logo.png',
      trustProfile: makeTrustProfile({
        supportEmail: 'support@test.example',
        supportPhone: '+2348000000000',
        foundedYear: 2018,
        socialLinks: {
          instagram: 'https://instagram.com/teststore',
          twitter: 'https://twitter.com/teststore',
        },
        returnPolicy: {
          summary: 'Returns accepted for 7 days.',
          windowDays: 7,
          returnMethod: 'carrier_dropoff',
          returnFees: 'free',
          localRoute: '/returns',
        },
      }),
    });

    expect(schema).toMatchObject({
      '@type': 'OnlineStore',
      foundingDate: '2018',
      contactPoint: {
        '@type': 'ContactPoint',
        contactType: 'customer service',
        email: 'support@test.example',
        telephone: '+2348000000000',
        availableLanguage: 'English',
      },
      hasMerchantReturnPolicy: {
        '@type': 'MerchantReturnPolicy',
        applicableCountry: 'NG',
        returnPolicyCountry: 'NG',
        merchantReturnDays: 7,
        returnMethod: 'https://schema.org/ReturnByMail',
        returnFees: 'https://schema.org/FreeReturn',
      },
    });

    expect(schema.sameAs).toEqual(
      expect.arrayContaining([
        'https://instagram.com/teststore',
        'https://twitter.com/teststore',
      ])
    );
  });
});

describe('generateMetaTitle', () => {
  describe('platform-list-only parenthetical compaction', () => {
    it('compacts redundant platform list with suffix and returns full title without ellipsis', () => {
      expect(
        generateMetaTitle(
          'Buy EA Sports FC 27 (PS5, PS4, Xbox, Switch & Switch 2) - ₦112,000',
          {
            suffix: 'Ogabassey',
          }
        )
      ).toBe('Buy EA Sports FC 27 - ₦112,000 | Ogabassey');
    });

    it('compacts (PS5 & Xbox Series X) when over maxLength', () => {
      expect(
        generateMetaTitle(
          'Buy Monster Hunter Wilds (PS5 & Xbox Series X) at the Best Price Guaranteed',
          {
            maxLength: 70,
            suffix: 'Ogabassey',
          }
        )
      ).toBe(
        'Buy Monster Hunter Wilds at the Best Price Guaranteed | Ogabassey'
      );
    });

    it('compacts (PS5 or Xbox) when over maxLength', () => {
      expect(
        generateMetaTitle(
          'Buy Monster Hunter Wilds (PS5 or Xbox) at the Best Price Guaranteed',
          {
            maxLength: 70,
            suffix: 'Ogabassey',
          }
        )
      ).toBe(
        'Buy Monster Hunter Wilds at the Best Price Guaranteed | Ogabassey'
      );
    });

    it('compacts (Nintendo Switch / Nintendo Switch 2) when over maxLength', () => {
      expect(
        generateMetaTitle(
          'Buy The Legend of Zelda (Nintendo Switch / Nintendo Switch 2) Pre-Order Now',
          {
            maxLength: 70,
            suffix: 'Ogabassey',
          }
        )
      ).toBe('Buy The Legend of Zelda Pre-Order Now | Ogabassey');
    });

    it('retains parenthetical untouched when short title already fits within maxLength', () => {
      expect(
        generateMetaTitle('EA Sports FC 27 (PS5, PS4)', {
          maxLength: 60,
        })
      ).toBe('EA Sports FC 27 (PS5, PS4)');

      expect(
        generateMetaTitle('EA Sports FC 27 (PS5, PS4)', {
          maxLength: 60,
          suffix: 'Store',
        })
      ).toBe('EA Sports FC 27 (PS5, PS4) | Store');
    });

    it('preserves single-platform parentheticals even when over maxLength', () => {
      const ps5 = generateMetaTitle(
        'Buy EA Sports FC 27 (PS5) - Ultimate Edition With Lots of Extra Bonus Content',
        {
          maxLength: 70,
          suffix: 'Ogabassey',
        }
      );
      expect(ps5).toContain('(PS5)');

      const switchTitle = generateMetaTitle(
        'The Legend of Zelda (Nintendo Switch) Tears of the Kingdom Special Edition Full Guide',
        {
          maxLength: 65,
          suffix: 'Shop',
        }
      );
      expect(switchTitle).toContain('(Nintendo Switch)');

      const switch2 = generateMetaTitle(
        'The Legend of Zelda (Nintendo Switch 2) Next Chapter Next-Gen Deluxe Set',
        {
          maxLength: 65,
          suffix: 'Shop',
        }
      );
      expect(switch2).toContain('(Nintendo Switch 2)');

      const xbox = generateMetaTitle(
        'Forza Motorsport (Xbox Series X) Premium Racing Championship Edition Deluxe Pack',
        {
          maxLength: 65,
          suffix: 'Shop',
        }
      );
      expect(xbox).toContain('(Xbox Series X)');
    });

    it('preserves single-platform synonym lists (fewer than 2 distinct identities) even when over maxLength', () => {
      const ps5Synonyms = generateMetaTitle(
        'EA Sports FC 27 (PS5 / PlayStation 5) Complete Season Pass and Pre-Order Bonus',
        {
          maxLength: 70,
          suffix: 'Shop',
        }
      );
      expect(ps5Synonyms).toContain('(PS5 / PlayStation 5)');

      const pcSynonyms = generateMetaTitle(
        'EA Sports FC 27 (PC / Windows / Steam) Complete Season Pass and Pre-Order Bonus',
        {
          maxLength: 70,
          suffix: 'Shop',
        }
      );
      expect(pcSynonyms).toContain('(PC / Windows / Steam)');

      const xboxSeriesSynonyms = generateMetaTitle(
        'Forza Motorsport (Xbox, Xbox Series X) Premium Racing Championship Edition Deluxe Pack',
        {
          maxLength: 65,
          suffix: 'Shop',
        }
      );
      expect(xboxSeriesSynonyms).toContain('(Xbox, Xbox Series X)');

      const xboxOneSynonyms = generateMetaTitle(
        'Forza Horizon 4 (Xbox, Xbox One) Complete Ultimate Edition Racing Pass Pack',
        {
          maxLength: 65,
          suffix: 'Shop',
        }
      );
      expect(xboxOneSynonyms).toContain('(Xbox, Xbox One)');
    });

    it('preserves mixed, unknown, edition, and condition qualifiers even when over maxLength', () => {
      const mixed = generateMetaTitle(
        'Sony PlayStation 5 (PS5, Disc Edition) Gaming Console with Extra DualSense Controller',
        {
          maxLength: 70,
          suffix: 'Ogabassey',
        }
      );
      expect(mixed).toContain('(PS5, Disc Edition)');

      const edition = generateMetaTitle(
        'Sony PlayStation 5 Slim (Disc Edition) Gaming Console with Extra DualSense Controller',
        {
          maxLength: 70,
          suffix: 'Ogabassey',
        }
      );
      expect(edition).toContain('(Disc Edition)');

      const wifi = generateMetaTitle(
        'Apple iPad Pro (Wi-Fi Only) 11-inch M4 Chip Liquid Retina Display Space Gray',
        {
          maxLength: 70,
          suffix: 'Ogabassey',
        }
      );
      expect(wifi).toContain('(Wi-Fi Only)');

      const refurbished = generateMetaTitle(
        'Apple iPhone 14 Pro Max (Refurbished) 256GB Deep Purple Unlocked Grade A Best Deal',
        {
          maxLength: 70,
          suffix: 'Ogabassey',
        }
      );
      expect(refurbished).toContain('(Refurbished)');
    });

    it('compacts Oxford-comma and pipe platform lists', () => {
      expect(
        generateMetaTitle(
          'Buy EA Sports FC 27 (PS5, PS4, and Xbox) - Best Price in Nigeria',
          {
            maxLength: 60,
            suffix: 'Store',
          }
        )
      ).toBe('Buy EA Sports FC 27 - Best Price in Nigeria | Store');

      expect(
        generateMetaTitle(
          'Buy EA Sports FC 27 (PS5 | PS4) - Best Price in Nigeria Today',
          {
            maxLength: 60,
            suffix: 'Store',
          }
        )
      ).toBe('Buy EA Sports FC 27 - Best Price in Nigeria Today | Store');

      expect(
        generateMetaTitle(
          'Buy Monster Hunter Wilds (PS5, Xbox Series X|S) at Best Price Guaranteed',
          {
            maxLength: 65,
            suffix: 'Ogabassey',
          }
        )
      ).toBe('Buy Monster Hunter Wilds at Best Price Guaranteed | Ogabassey');
    });

    it('compacts unspaced parenthetical without token concatenation', () => {
      expect(
        generateMetaTitle(
          'Buy EA Sports FC 27(PS5, PS4) Edition Now Online at Best Price',
          {
            suffix: 'Ogabassey',
          }
        )
      ).toBe(
        'Buy EA Sports FC 27 Edition Now Online at Best Price | Ogabassey'
      );
    });

    it('compacts parenthetical before punctuation without leaving a leading space', () => {
      expect(
        generateMetaTitle(
          'Buy EA Sports FC 27 (PS5, PS4): Best Price in Nigeria Today',
          {
            suffix: 'Ogabassey',
          }
        )
      ).toBe('Buy EA Sports FC 27: Best Price in Nigeria Today | Ogabassey');
    });

    it('slices compacted title to allowedBaseLength and appends ellipsis when still too long with suffix', () => {
      const title = generateMetaTitle(
        'Buy EA Sports FC 27 (PS5, PS4, Xbox, Switch & Switch 2) - Ultimate Championship Edition with Extra DLC and Season Pass',
        {
          maxLength: 70,
          suffix: 'Ogabassey',
        }
      );
      expect(title).toBe(
        'Buy EA Sports FC 27 - Ultimate Championship Edition... | Ogabassey'
      );
      expect(title.length).toBeLessThanOrEqual(70);
    });

    it('preserves existing fallback slice behavior when suffix is overlong and allowedBaseLength <= 0', () => {
      const title = generateMetaTitle(
        'Buy EA Sports FC 27 (PS5, PS4, Xbox, Switch & Switch 2)',
        {
          maxLength: 20,
          suffix: 'Very Long Merchant Suffix That Exceeds Max',
        }
      );
      expect(title).toBe('Buy EA Sports FC 27');
      expect(title.length).toBeLessThanOrEqual(20);
    });

    it('handles genuine no-suffix path when title fits after compaction without ellipsis', () => {
      expect(
        generateMetaTitle(
          'Buy EA Sports FC 27 (PS5, PS4, Xbox, Switch & Switch 2) - Best Price',
          {
            maxLength: 50,
          }
        )
      ).toBe('Buy EA Sports FC 27 - Best Price');
    });

    it('handles genuine no-suffix path when title is still too long after compaction', () => {
      expect(
        generateMetaTitle(
          'Buy EA Sports FC 27 (PS5, PS4, Xbox, Switch & Switch 2) - Ultimate Championship League Edition',
          {
            maxLength: 40,
          }
        )
      ).toBe('Buy EA Sports FC 27 - Ultimate...');
    });

    it('handles empty titles, fallbacks, and identity suffixes correctly', () => {
      expect(generateMetaTitle('', { fallback: 'Default Title' })).toBe(
        'Default Title'
      );
      expect(generateMetaTitle('')).toBe('');
      expect(generateMetaTitle('Ogabassey', { suffix: 'Ogabassey' })).toBe(
        'Ogabassey'
      );
    });

    it('handles titles consisting solely of a redundant platform list when over length', () => {
      expect(
        generateMetaTitle('(PS5, PS4, Xbox, Switch)', {
          suffix: 'Ogabassey',
          maxLength: 30,
        })
      ).toBe('Ogabassey');
      expect(
        generateMetaTitle('(PS5, PS4, Xbox, Switch)', { maxLength: 20 })
      ).toBe('');
      expect(
        generateMetaTitle('(PS5, PS4, Xbox, Switch)', {
          suffix: 'Ogabassey Electronics Store',
          maxLength: 15,
        })
      ).toBe('Ogabassey...');
    });

    it('strips orphan trailing separators before suffix or end of title when over length', () => {
      expect(
        generateMetaTitle('Buy EA Sports FC 27 - (PS5, PS4, Xbox, Switch)', {
          suffix: 'Ogabassey',
          maxLength: 40,
        })
      ).toBe('Buy EA Sports FC 27 | Ogabassey');
      expect(
        generateMetaTitle('Buy EA Sports FC 27, (PS5, PS4, Xbox, Switch)', {
          suffix: 'Ogabassey',
          maxLength: 40,
        })
      ).toBe('Buy EA Sports FC 27 | Ogabassey');
      expect(
        generateMetaTitle('Buy EA Sports FC 27: (PS5, PS4, Xbox, Switch)', {
          suffix: 'Ogabassey',
          maxLength: 40,
        })
      ).toBe('Buy EA Sports FC 27 | Ogabassey');
      expect(
        generateMetaTitle('Buy EA Sports FC 27 - (PS5, PS4, Xbox, Switch)', {
          maxLength: 30,
        })
      ).toBe('Buy EA Sports FC 27');
    });

    it('handles titles with orphan separators before terminal punctuation when compacted', () => {
      expect(
        generateMetaTitle('Buy EA Sports FC 27 - (PS5, PS4, Xbox, Switch).', {
          suffix: 'Ogabassey',
          maxLength: 40,
        })
      ).toBe('Buy EA Sports FC 27. | Ogabassey');
      expect(
        generateMetaTitle('Buy EA Sports FC 27 - (PS5, PS4, Xbox, Switch).', {
          maxLength: 30,
        })
      ).toBe('Buy EA Sports FC 27.');
      expect(
        generateMetaTitle('Buy EA Sports FC 27 - (PS5 - PS4)', {
          suffix: 'Ogabassey',
          maxLength: 40,
        })
      ).toBe('Buy EA Sports FC 27 | Ogabassey');
      expect(
        generateMetaTitle(
          'Buy EA Sports FC 27 (PS5 Pro, Xbox Series X) - Best Deal',
          {
            suffix: 'Ogabassey',
            maxLength: 50,
          }
        )
      ).toBe('Buy EA Sports FC 27 - Best Deal | Ogabassey');
    });
  });

  describe('isRedundantPlatformListParenthetical detector', () => {
    it('returns true for multi-platform lists', () => {
      expect(
        isRedundantPlatformListParenthetical(
          'PS5, PS4, Xbox, Switch & Switch 2'
        )
      ).toBe(true);
      expect(isRedundantPlatformListParenthetical('PS5 & Xbox Series X')).toBe(
        true
      );
      expect(
        isRedundantPlatformListParenthetical(
          'Nintendo Switch / Nintendo Switch 2'
        )
      ).toBe(true);
      expect(isRedundantPlatformListParenthetical('switch, pc')).toBe(true);
      expect(
        isRedundantPlatformListParenthetical('playstation 4; xbox one; steam')
      ).toBe(true);
      expect(isRedundantPlatformListParenthetical('PS5, PS4, and Xbox')).toBe(
        true
      );
      expect(isRedundantPlatformListParenthetical('PS5, PS4, & Xbox')).toBe(
        true
      );
      expect(isRedundantPlatformListParenthetical('PS5 | PS4')).toBe(true);
      expect(isRedundantPlatformListParenthetical('PS5, Xbox Series X|S')).toBe(
        true
      );
      expect(isRedundantPlatformListParenthetical('PS5, Xbox Series X/S')).toBe(
        true
      );
      expect(
        isRedundantPlatformListParenthetical('PS5, Xbox Series X & S')
      ).toBe(true);
      expect(
        isRedundantPlatformListParenthetical('PS5, Xbox Series X and S')
      ).toBe(true);
      expect(isRedundantPlatformListParenthetical('PS5, Series X & S')).toBe(
        true
      );
      expect(isRedundantPlatformListParenthetical('PS5, Series S and X')).toBe(
        true
      );
      expect(isRedundantPlatformListParenthetical('Xbox, PS5')).toBe(true);
      expect(
        isRedundantPlatformListParenthetical('Xbox, Xbox Series X, PS5')
      ).toBe(true);
      expect(isRedundantPlatformListParenthetical('PS5 - PS4')).toBe(true);
      expect(isRedundantPlatformListParenthetical('PS5 – PS4')).toBe(true);
      expect(isRedundantPlatformListParenthetical('PS5 — PS4')).toBe(true);
      expect(isRedundantPlatformListParenthetical('PS5-PS4')).toBe(true);
      expect(isRedundantPlatformListParenthetical('Xbox Series X - PS5')).toBe(
        true
      );
      expect(
        isRedundantPlatformListParenthetical('PS5 Pro, Xbox Series X')
      ).toBe(true);
      expect(
        isRedundantPlatformListParenthetical('PlayStation 5 Pro, Steam Deck')
      ).toBe(true);
      expect(
        isRedundantPlatformListParenthetical('Nintendo Switch OLED, Xbox One X')
      ).toBe(true);
      expect(isRedundantPlatformListParenthetical('Switch OLED, PS5')).toBe(
        true
      );
      expect(isRedundantPlatformListParenthetical('Steam Deck, Switch')).toBe(
        true
      );
      expect(isRedundantPlatformListParenthetical('Xbox One X, PS4')).toBe(
        true
      );
      expect(isRedundantPlatformListParenthetical('Switch Lite, PS5')).toBe(
        true
      );
      expect(isRedundantPlatformListParenthetical('PS4 Pro, PS5')).toBe(true);
      expect(
        isRedundantPlatformListParenthetical('PS5 Slim, Xbox Series X')
      ).toBe(true);
      expect(isRedundantPlatformListParenthetical('Xbox 360, PS3')).toBe(true);
      expect(
        isRedundantPlatformListParenthetical('PS Vita, Nintendo Switch')
      ).toBe(true);
      expect(
        isRedundantPlatformListParenthetical('Wii U, Nintendo Switch')
      ).toBe(true);
    });

    it('returns false for single-platform parentheticals', () => {
      expect(isRedundantPlatformListParenthetical('PS5')).toBe(false);
      expect(isRedundantPlatformListParenthetical('PS5 Pro')).toBe(false);
      expect(isRedundantPlatformListParenthetical('PS5 Slim')).toBe(false);
      expect(isRedundantPlatformListParenthetical('PlayStation 5 Pro')).toBe(
        false
      );
      expect(isRedundantPlatformListParenthetical('PS4 Pro')).toBe(false);
      expect(isRedundantPlatformListParenthetical('PS4 Slim')).toBe(false);
      expect(isRedundantPlatformListParenthetical('Steam Deck')).toBe(false);
      expect(isRedundantPlatformListParenthetical('Xbox One X')).toBe(false);
      expect(isRedundantPlatformListParenthetical('Xbox 360')).toBe(false);
      expect(isRedundantPlatformListParenthetical('PS Vita')).toBe(false);
      expect(isRedundantPlatformListParenthetical('Wii U')).toBe(false);
      expect(isRedundantPlatformListParenthetical('Nintendo Switch')).toBe(
        false
      );
      expect(isRedundantPlatformListParenthetical('Nintendo Switch OLED')).toBe(
        false
      );
      expect(isRedundantPlatformListParenthetical('Switch OLED')).toBe(false);
      expect(isRedundantPlatformListParenthetical('Switch Lite')).toBe(false);
      expect(isRedundantPlatformListParenthetical('Nintendo Switch 2')).toBe(
        false
      );
      expect(isRedundantPlatformListParenthetical('Xbox Series X')).toBe(false);
      expect(isRedundantPlatformListParenthetical('Xbox Series S')).toBe(false);
      expect(isRedundantPlatformListParenthetical('Xbox Series X|S')).toBe(
        false
      );
      expect(isRedundantPlatformListParenthetical('Xbox Series X/S')).toBe(
        false
      );
      expect(isRedundantPlatformListParenthetical('Xbox Series X & S')).toBe(
        false
      );
      expect(isRedundantPlatformListParenthetical('Xbox Series X and S')).toBe(
        false
      );
      expect(isRedundantPlatformListParenthetical('Series X & S')).toBe(false);
      expect(isRedundantPlatformListParenthetical('Series S and X')).toBe(
        false
      );
      expect(isRedundantPlatformListParenthetical('Xbox, Xbox Series X')).toBe(
        false
      );
      expect(isRedundantPlatformListParenthetical('Xbox, Xbox One')).toBe(
        false
      );
      expect(isRedundantPlatformListParenthetical('Xbox / Xbox Series X')).toBe(
        false
      );
    });

    it('returns false for single-platform synonym lists with fewer than 2 distinct identities', () => {
      expect(isRedundantPlatformListParenthetical('PS5 / PlayStation 5')).toBe(
        false
      );
      expect(isRedundantPlatformListParenthetical('PS5, PS5 Pro')).toBe(false);
      expect(isRedundantPlatformListParenthetical('PS5, PS5 Slim')).toBe(false);
      expect(isRedundantPlatformListParenthetical('PS4, PS4 Pro')).toBe(false);
      expect(
        isRedundantPlatformListParenthetical('Xbox Series X, Xbox Series S')
      ).toBe(false);
      expect(
        isRedundantPlatformListParenthetical('Nintendo Switch, Switch OLED')
      ).toBe(false);
      expect(isRedundantPlatformListParenthetical('Xbox One, Xbox One X')).toBe(
        false
      );
      expect(isRedundantPlatformListParenthetical('PC / Windows / Steam')).toBe(
        false
      );
    });

    it('returns false for mixed, unknown, condition, or edition qualifiers', () => {
      expect(isRedundantPlatformListParenthetical('PS5, Disc Edition')).toBe(
        false
      );
      expect(isRedundantPlatformListParenthetical('Disc Edition')).toBe(false);
      expect(isRedundantPlatformListParenthetical('Wi-Fi Only')).toBe(false);
      expect(isRedundantPlatformListParenthetical('Refurbished')).toBe(false);
      expect(isRedundantPlatformListParenthetical('')).toBe(false);
      expect(isRedundantPlatformListParenthetical('PS5, ')).toBe(false);
    });
  });

  describe('stripRedundantPlatformParentheticals', () => {
    it('strips redundant platform parentheticals and normalizes spacing and punctuation', () => {
      expect(
        stripRedundantPlatformParentheticals(
          'Buy EA Sports FC 27(PS5, PS4) Edition Now Online at Best Price'
        )
      ).toBe('Buy EA Sports FC 27 Edition Now Online at Best Price');

      expect(
        stripRedundantPlatformParentheticals(
          'Buy EA Sports FC 27 (PS5, PS4): Best Price in Nigeria Today'
        )
      ).toBe('Buy EA Sports FC 27: Best Price in Nigeria Today');

      expect(
        stripRedundantPlatformParentheticals(
          'Buy EA Sports FC 27 (PS5, PS4), Best Price'
        )
      ).toBe('Buy EA Sports FC 27, Best Price');

      expect(
        stripRedundantPlatformParentheticals(
          'Buy EA Sports FC 27 (PS5, PS4)! In Stock'
        )
      ).toBe('Buy EA Sports FC 27! In Stock');
    });

    it('preserves meaningful qualifiers unchanged', () => {
      expect(
        stripRedundantPlatformParentheticals(
          'PlayStation 5 Console (Disc Edition)'
        )
      ).toBe('PlayStation 5 Console (Disc Edition)');

      expect(
        stripRedundantPlatformParentheticals('iPad Pro 11-inch (Wi-Fi Only)')
      ).toBe('iPad Pro 11-inch (Wi-Fi Only)');

      expect(
        stripRedundantPlatformParentheticals('iPhone 13 128GB (Refurbished)')
      ).toBe('iPhone 13 128GB (Refurbished)');
    });

    it('does not mutate unrelated punctuation spacing elsewhere in the string', () => {
      expect(
        stripRedundantPlatformParentheticals(
          'Buy Console (Disc Edition) : Best Price ... Guaranteed !'
        )
      ).toBe('Buy Console (Disc Edition) : Best Price ... Guaranteed !');

      expect(
        stripRedundantPlatformParentheticals(
          'Buy Game (PS5, PS4) : Best Price ... Guaranteed !'
        )
      ).toBe('Buy Game: Best Price ... Guaranteed !');
    });

    it('handles leading redundant parentheticals without leaving orphan punctuation', () => {
      expect(
        stripRedundantPlatformParentheticals('(PS5, PS4): Best Game Ever')
      ).toBe('Best Game Ever');
      expect(
        stripRedundantPlatformParentheticals('(PS5, PS4), Best Game Ever')
      ).toBe('Best Game Ever');
      expect(
        stripRedundantPlatformParentheticals('(PS5, PS4) - Best Game Ever')
      ).toBe('Best Game Ever');
      expect(
        stripRedundantPlatformParentheticals('(PS5, PS4) / Best Game Ever')
      ).toBe('Best Game Ever');
      expect(
        stripRedundantPlatformParentheticals('(PS5, PS4) & Best Game Ever')
      ).toBe('Best Game Ever');
      expect(
        stripRedundantPlatformParentheticals('(PS5, PS4) -30% Deal Today')
      ).toBe('-30% Deal Today');
      expect(stripRedundantPlatformParentheticals('(PS5, PS4) /deal')).toBe(
        '/deal'
      );
      expect(stripRedundantPlatformParentheticals('(PS5, PS4) &sons')).toBe(
        '&sons'
      );
    });

    it('compacts adjacent redundant parentheticals without creating double spaces', () => {
      expect(
        stripRedundantPlatformParentheticals(
          'Game (PS5, PS4) (Xbox, PC) Edition'
        )
      ).toBe('Game Edition');
    });

    it('preserves single space before a preserved parenthetical following a redundant parenthetical', () => {
      expect(
        stripRedundantPlatformParentheticals(
          'Game (PS5, PS4) (Disc Edition) Edition'
        )
      ).toBe('Game (Disc Edition) Edition');
      expect(
        stripRedundantPlatformParentheticals(
          'Game (PS5, PS4) (Refurbished) Edition'
        )
      ).toBe('Game (Refurbished) Edition');
      expect(
        stripRedundantPlatformParentheticals('(PS5, PS4) (Disc Edition)')
      ).toBe('(Disc Edition)');
    });

    it('handles trailing redundant parentheticals without leaving orphan separators', () => {
      expect(
        stripRedundantPlatformParentheticals('Buy Game - (PS5, PS4)')
      ).toBe('Buy Game');
      expect(stripRedundantPlatformParentheticals('Buy Game, (PS5, PS4)')).toBe(
        'Buy Game'
      );
      expect(stripRedundantPlatformParentheticals('Buy Game: (PS5, PS4)')).toBe(
        'Buy Game'
      );
      expect(stripRedundantPlatformParentheticals('Buy Game; (PS5, PS4)')).toBe(
        'Buy Game'
      );
      expect(
        stripRedundantPlatformParentheticals('Buy Game | (PS5, PS4)')
      ).toBe('Buy Game');
      expect(
        stripRedundantPlatformParentheticals('Buy Game / (PS5, PS4)')
      ).toBe('Buy Game');
      expect(
        stripRedundantPlatformParentheticals('Buy Game & (PS5, PS4)')
      ).toBe('Buy Game');
      expect(
        stripRedundantPlatformParentheticals('Buy Game – (PS5, PS4)')
      ).toBe('Buy Game');
      expect(
        stripRedundantPlatformParentheticals('Buy Game — (PS5, PS4)')
      ).toBe('Buy Game');
      expect(
        stripRedundantPlatformParentheticals('Spider-Man (PS5, PS4)')
      ).toBe('Spider-Man');
      expect(
        stripRedundantPlatformParentheticals(
          'Buy Game - (Disc Edition) (PS5, PS4)'
        )
      ).toBe('Buy Game - (Disc Edition)');
      expect(
        stripRedundantPlatformParentheticals('Buy Game (PS5, PS4) -')
      ).toBe('Buy Game');
      expect(
        stripRedundantPlatformParentheticals('Buy Game (PS5, PS4) and')
      ).toBe('Buy Game');
      expect(
        stripRedundantPlatformParentheticals('Buy Game (PS5, PS4) |')
      ).toBe('Buy Game');
      expect(
        stripRedundantPlatformParentheticals('Buy Game (PS5, PS4) /')
      ).toBe('Buy Game');
      expect(
        stripRedundantPlatformParentheticals('Buy Game (PS5, PS4) &')
      ).toBe('Buy Game');
      expect(
        stripRedundantPlatformParentheticals('Buy Game (PS5, PS4) –')
      ).toBe('Buy Game');
      expect(
        stripRedundantPlatformParentheticals('Buy Game (PS5, PS4) —')
      ).toBe('Buy Game');
    });

    it('drops orphan separators before retained terminal punctuation', () => {
      expect(
        stripRedundantPlatformParentheticals('Buy Game - (PS5, PS4).')
      ).toBe('Buy Game.');
      expect(
        stripRedundantPlatformParentheticals('Buy Game - (PS5, PS4),')
      ).toBe('Buy Game,');
      expect(
        stripRedundantPlatformParentheticals('Buy Game - (PS5, PS4):')
      ).toBe('Buy Game:');
      expect(
        stripRedundantPlatformParentheticals('Buy Game - (PS5, PS4);')
      ).toBe('Buy Game;');
      expect(
        stripRedundantPlatformParentheticals('Buy Game - (PS5, PS4)!')
      ).toBe('Buy Game!');
      expect(
        stripRedundantPlatformParentheticals('Buy Game - (PS5, PS4)?')
      ).toBe('Buy Game?');
      expect(
        stripRedundantPlatformParentheticals('Buy Game – (PS5, PS4).')
      ).toBe('Buy Game.');
      expect(
        stripRedundantPlatformParentheticals('Buy Game — (PS5, PS4).')
      ).toBe('Buy Game.');
      expect(
        stripRedundantPlatformParentheticals('Buy Game | (PS5, PS4).')
      ).toBe('Buy Game.');
      expect(
        stripRedundantPlatformParentheticals('Buy Game / (PS5, PS4).')
      ).toBe('Buy Game.');
      expect(
        stripRedundantPlatformParentheticals('Buy Game & (PS5, PS4).')
      ).toBe('Buy Game.');
      expect(
        stripRedundantPlatformParentheticals('Buy Game, (PS5, PS4).')
      ).toBe('Buy Game.');
      expect(
        stripRedundantPlatformParentheticals('Buy Game: (PS5, PS4).')
      ).toBe('Buy Game.');
      expect(
        stripRedundantPlatformParentheticals('Buy Game; (PS5, PS4).')
      ).toBe('Buy Game.');
      expect(
        stripRedundantPlatformParentheticals('Buy Game - (PS5 - PS4).')
      ).toBe('Buy Game.');
      expect(
        stripRedundantPlatformParentheticals(
          'Buy Game - (PS5 Pro, Xbox Series X).'
        )
      ).toBe('Buy Game.');
      expect(
        stripRedundantPlatformParentheticals('Spider-Man - (PS5, PS4).')
      ).toBe('Spider-Man.');
    });

    it('does not remove leading punctuation when the stripped parenthetical is non-leading', () => {
      expect(
        stripRedundantPlatformParentheticals('-30% Deal (PS5, PS4) Today')
      ).toBe('-30% Deal Today');
      expect(
        stripRedundantPlatformParentheticals(
          '| Special Offer (PS5, PS4) Right Now'
        )
      ).toBe('| Special Offer Right Now');
    });

    it('localizes spacing normalization without collapsing double spaces elsewhere', () => {
      expect(
        stripRedundantPlatformParentheticals(
          'Deal  of the Day (PS5, PS4) Sale  Now'
        )
      ).toBe('Deal  of the Day Sale  Now');
    });

    it('localizes orphan separator cleanup to the removed parenthetical boundary without touching distant punctuation', () => {
      expect(
        stripRedundantPlatformParentheticals(
          'Buy Game (PS5, PS4) - Bonus: ...And Justice for All'
        )
      ).toBe('Buy Game - Bonus: ...And Justice for All');

      expect(
        stripRedundantPlatformParentheticals('Game (PS5, PS4) Finals - : Sale')
      ).toBe('Game Finals - : Sale');

      expect(
        generateMetaTitle(
          'Buy Game (PS5, PS4) - Bonus: ...And Justice for All',
          { maxLength: 45 }
        )
      ).toBe('Buy Game - Bonus: ...And Justice for All');
    });

    it('handles adjoining word conjunctions when platform list is stripped', () => {
      expect(
        stripRedundantPlatformParentheticals('(PS5, PS4) and Best Game')
      ).toBe('Best Game');
      expect(
        stripRedundantPlatformParentheticals('(PS5 or PS4) or Best Game')
      ).toBe('Best Game');
      expect(
        stripRedundantPlatformParentheticals('Buy Game and (PS5, PS4)')
      ).toBe('Buy Game');
      expect(
        stripRedundantPlatformParentheticals('Buy Game or (PS5, PS4)')
      ).toBe('Buy Game');
      expect(
        stripRedundantPlatformParentheticals('Buy Game and (PS5, PS4).')
      ).toBe('Buy Game.');
      expect(
        stripRedundantPlatformParentheticals('Buy Game or (PS5, PS4).')
      ).toBe('Buy Game.');
    });

    it('processes long separator runs without catastrophic backtracking', () => {
      const longSeparatorsNoParen = `Buy Game ${'-'.repeat(50)} Edition Today`;
      expect(stripRedundantPlatformParentheticals(longSeparatorsNoParen)).toBe(
        longSeparatorsNoParen
      );

      const longSeparatorsWithParen = `Buy Game ${'-'.repeat(50)} (PS5, PS4) Edition Today`;
      expect(
        stripRedundantPlatformParentheticals(longSeparatorsWithParen)
      ).toBe(`Buy Game ${'-'.repeat(50)} Edition Today`);
    });
  });
});

describe('getProductUrl', () => {
  it('falls back to the slug-based storefront path when canonical_url is absent', () => {
    expect(
      getProductUrl(
        makeProduct({
          category: 'Phones',
          slug: 'test-product',
        })
      )
    ).toBe('/phones/test-product');
  });

  it('uses a same-domain canonical_url without double-prefixing the path', () => {
    expect(
      getProductUrl(
        makeProduct({
          canonical_url: 'https://usebaci.com/products/test-product',
          slug: 'test-product',
        })
      )
    ).toBe('/products/test-product');
  });

  it('falls back predictably when canonical_url is malformed', () => {
    expect(
      getProductUrl(
        makeProduct({
          canonical_url: 'https://[invalid',
          slug: 'test-product',
        })
      )
    ).toBe('/products/test-product');
  });

  it('strips merchant-slug prefix from /{merchantSlug}/{category}/{product} canonicals when the second segment is a known storefront root', () => {
    // /ogabassey/smartphones/iphone-15 has 3 segments; `smartphones` is a
    // known storefront root, so `ogabassey` is recognized as the merchant
    // slug prefix and stripped, leaving /smartphones/iphone-15.
    expect(
      getProductUrl(
        makeProduct({
          canonical_url: 'https://usebaci.com/ogabassey/smartphones/iphone-15',
          slug: 'iphone-15',
        })
      )
    ).toBe('/smartphones/iphone-15');
  });

  it('does NOT strip the first segment of a 3-segment canonical when the second segment is not a known storefront root', () => {
    // Regression: previously `/phones/iphone-15/black` (3 segments) was
    // mis-rewritten to `/iphone-15/black` because the first segment was not
    // in STOREFRONT_ROOT_SEGMENTS. The guard now requires positive evidence
    // (a known storefront root in position 2) before stripping, so this 3+
    // segment canonical that doesn't match the merchant-prefix pattern
    // simply falls through to the slug-based fallback.
    expect(
      getProductUrl(
        makeProduct({
          canonical_url: 'https://usebaci.com/phones/iphone-15/black',
          slug: 'iphone-15',
          category: 'Phones',
        })
      )
    ).toBe('/phones/iphone-15');
  });
});

describe('generateBlogPostSchema', () => {
  const baseBlogSchemaInput = {
    title: 'M4 MacBook Air Review',
    description: 'A practical buyer guide for Nigerian shoppers.',
    url: 'https://ogabassey.com/blog/m4-macbook-air-review',
    datePublished: '2026-05-01T10:00:00.000Z',
    author: {
      name: 'Ogabassey Editorial',
      url: 'https://ogabassey.com',
    },
    publisher: {
      name: 'Ogabassey',
      logo: 'https://ogabassey.com/logo.png',
      url: 'https://ogabassey.com',
    },
  };

  it('adds a per-author @id and links the post to its Blog via isPartOf', () => {
    const schema = generateBlogPostSchema({
      ...baseBlogSchemaInput,
      blogId: 'https://ogabassey.com/blog#blog',
    });

    expect((schema.author as Record<string, unknown>)['@id']).toBe(
      'https://ogabassey.com#author-ogabassey-editorial'
    );
    expect(schema.isPartOf).toEqual({
      '@type': 'Blog',
      '@id': 'https://ogabassey.com/blog#blog',
    });
  });

  it('uses an explicit author entity id separately from the profile URL', () => {
    const schema = generateBlogPostSchema({
      ...baseBlogSchemaInput,
      author: {
        ...baseBlogSchemaInput.author,
        id: 'https://ogabassey.com#author-bassey-john',
        url: 'https://ogabassey.com/blog/author/bassey-john',
      },
    });

    expect((schema.author as Record<string, unknown>)['@id']).toBe(
      'https://ogabassey.com#author-bassey-john'
    );
    expect((schema.author as Record<string, unknown>).url).toBe(
      'https://ogabassey.com/blog/author/bassey-john'
    );
  });

  it('drops the author @id when author.id is an unsafe URL', () => {
    const schema = generateBlogPostSchema({
      ...baseBlogSchemaInput,
      author: {
        ...baseBlogSchemaInput.author,
        id: 'javascript:alert(1)#author-x',
      },
    });

    expect((schema.author as Record<string, unknown>)['@id']).toBeUndefined();
  });

  it('drops the publisher @id when publisher.id is an unsafe URL', () => {
    const schema = generateBlogPostSchema({
      ...baseBlogSchemaInput,
      publisher: {
        ...baseBlogSchemaInput.publisher,
        id: 'javascript:alert(1)',
      },
    });

    expect(
      (schema.publisher as Record<string, unknown>)['@id']
    ).toBeUndefined();
  });

  it('omits isPartOf when blogId is an unsafe URL', () => {
    const schema = generateBlogPostSchema({
      ...baseBlogSchemaInput,
      blogId: 'data:text/html,bad',
    });

    expect(schema.isPartOf).toBeUndefined();
  });

  it('omits isPartOf when no blogId is provided', () => {
    const schema = generateBlogPostSchema(baseBlogSchemaInput);

    expect(schema.isPartOf).toBeUndefined();
  });

  it('omits author @id when author.url is not provided', () => {
    const schema = generateBlogPostSchema({
      ...baseBlogSchemaInput,
      author: { name: 'Anonymous' },
    });

    expect((schema.author as Record<string, unknown>)['@id']).toBeUndefined();
  });

  it('emits the author headshot as Person.image when provided', () => {
    const schema = generateBlogPostSchema({
      ...baseBlogSchemaInput,
      author: {
        ...baseBlogSchemaInput.author,
        image:
          'https://cdn.ogabassey.com/merchants/ogabassey/authors/bassey-john.jpg',
      },
    });

    expect((schema.author as Record<string, unknown>).image).toBe(
      'https://cdn.ogabassey.com/merchants/ogabassey/authors/bassey-john.jpg'
    );
  });

  it('drops the author image when author.image is an unsafe URL', () => {
    const schema = generateBlogPostSchema({
      ...baseBlogSchemaInput,
      author: {
        ...baseBlogSchemaInput.author,
        image: 'javascript:alert(1)',
      },
    });

    expect((schema.author as Record<string, unknown>).image).toBeUndefined();
  });

  it('emits a Google Discover image array when persisted image URLs are supplied', () => {
    const schema = generateBlogPostSchema({
      ...baseBlogSchemaInput,
      image: 'https://ogabassey.com/opengraph-image',
      imageUrls: [
        'https://cdn.ogabassey.com/media/merchant-1/blog/post/landscape_16x9.webp',
        'https://cdn.ogabassey.com/media/merchant-1/blog/post/standard_4x3.webp',
        'https://cdn.ogabassey.com/media/merchant-1/blog/post/square_1x1.webp',
      ],
    });

    expect(schema.image).toEqual([
      'https://cdn.ogabassey.com/media/merchant-1/blog/post/landscape_16x9.webp',
      'https://cdn.ogabassey.com/media/merchant-1/blog/post/standard_4x3.webp',
      'https://cdn.ogabassey.com/media/merchant-1/blog/post/square_1x1.webp',
    ]);
  });

  it('prefers BlogPosting ImageObjects with width and height when supplied', () => {
    const schema = generateBlogPostSchema({
      ...baseBlogSchemaInput,
      imageUrls: [
        'https://cdn.ogabassey.com/media/merchant-1/blog/post/fallback.webp',
      ],
      imageObjects: [
        {
          '@type': 'ImageObject',
          url: 'https://cdn.ogabassey.com/media/merchant-1/blog/post/landscape_16x9.webp',
          width: 1200,
          height: 675,
        },
      ],
    });

    expect(schema.image).toEqual([
      {
        '@type': 'ImageObject',
        url: 'https://cdn.ogabassey.com/media/merchant-1/blog/post/landscape_16x9.webp',
        width: 1200,
        height: 675,
      },
    ]);
  });

  it('falls back to imageUrls when imageObjects contain no valid URLs', () => {
    const schema = generateBlogPostSchema({
      ...baseBlogSchemaInput,
      imageUrls: [
        'https://cdn.ogabassey.com/media/merchant-1/blog/fallback.webp',
      ],
      imageObjects: [
        { url: '', width: 1200, height: 675 },
        { url: 'javascript:alert(1)', width: 1200, height: 675 },
      ],
    });

    expect(schema.image).toEqual([
      'https://cdn.ogabassey.com/media/merchant-1/blog/fallback.webp',
    ]);
  });

  it('omits invalid ImageObject dimensions without dropping the valid image URL', () => {
    const schema = generateBlogPostSchema({
      ...baseBlogSchemaInput,
      imageObjects: [
        {
          url: 'https://cdn.ogabassey.com/media/merchant-1/blog/negative.webp',
          width: -1,
          height: 0,
        },
        {
          url: 'https://cdn.ogabassey.com/media/merchant-1/blog/float.webp',
          width: 1200.5,
          height: Number.NaN,
        },
        {
          url: 'https://cdn.ogabassey.com/media/merchant-1/blog/infinity.webp',
          width: Number.POSITIVE_INFINITY,
          height: 675,
        },
      ],
    });

    expect(schema.image).toEqual([
      {
        '@type': 'ImageObject',
        url: 'https://cdn.ogabassey.com/media/merchant-1/blog/negative.webp',
      },
      {
        '@type': 'ImageObject',
        url: 'https://cdn.ogabassey.com/media/merchant-1/blog/float.webp',
      },
      {
        '@type': 'ImageObject',
        url: 'https://cdn.ogabassey.com/media/merchant-1/blog/infinity.webp',
        height: 675,
      },
    ]);
  });

  it('falls back to imageUrls when imageObjects is empty', () => {
    const schema = generateBlogPostSchema({
      ...baseBlogSchemaInput,
      imageUrls: [
        'https://cdn.ogabassey.com/media/merchant-1/blog/fallback.webp',
      ],
      imageObjects: [],
    });

    expect(schema.image).toEqual([
      'https://cdn.ogabassey.com/media/merchant-1/blog/fallback.webp',
    ]);
  });

  it('keeps only valid ImageObjects from a mixed imageObjects array', () => {
    const schema = generateBlogPostSchema({
      ...baseBlogSchemaInput,
      imageObjects: [
        {
          url: 'https://cdn.ogabassey.com/media/merchant-1/blog/valid.webp',
          width: 1200,
          height: 675,
        },
        { url: 'data:text/html,bad', width: 1200, height: 675 },
      ],
    });

    expect(schema.image).toEqual([
      {
        '@type': 'ImageObject',
        url: 'https://cdn.ogabassey.com/media/merchant-1/blog/valid.webp',
        width: 1200,
        height: 675,
      },
    ]);
  });

  it('keeps the legacy single image object when only image is supplied', () => {
    const schema = generateBlogPostSchema({
      ...baseBlogSchemaInput,
      image: 'https://cdn.ogabassey.com/media/merchant-1/blog/original.png',
    });

    expect(schema.image).toEqual({
      '@type': 'ImageObject',
      url: 'https://cdn.ogabassey.com/media/merchant-1/blog/original.png',
    });
  });

  it('omits image markup when imageUrls are empty or blank', () => {
    expect(
      generateBlogPostSchema({
        ...baseBlogSchemaInput,
        imageUrls: [],
      })
    ).not.toHaveProperty('image');

    expect(
      generateBlogPostSchema({
        ...baseBlogSchemaInput,
        imageUrls: [' ', ''],
      })
    ).not.toHaveProperty('image');
  });

  it('filters blank imageUrls but keeps valid entries', () => {
    const schema = generateBlogPostSchema({
      ...baseBlogSchemaInput,
      imageUrls: [
        'https://cdn.ogabassey.com/media/merchant-1/blog/post/landscape_16x9.webp',
        '',
        ' ',
      ],
    });

    expect(schema.image).toEqual([
      'https://cdn.ogabassey.com/media/merchant-1/blog/post/landscape_16x9.webp',
    ]);
  });

  it('adds sanitized author and publisher sameAs identity links', () => {
    const schema = generateBlogPostSchema({
      ...baseBlogSchemaInput,
      author: {
        ...baseBlogSchemaInput.author,
        sameAs: [
          'https://www.linkedin.com/in/editor',
          'javascript:alert(1)',
          'https://www.linkedin.com/in/editor',
        ],
      },
      publisher: {
        ...baseBlogSchemaInput.publisher,
        sameAs: ['https://www.instagram.com/ogabassey/'],
      },
    });

    expect((schema.author as Record<string, unknown>).sameAs).toEqual([
      'https://www.linkedin.com/in/editor',
    ]);
    expect((schema.publisher as Record<string, unknown>).sameAs).toEqual([
      'https://www.instagram.com/ogabassey/',
    ]);
  });

  it('links the publisher to the standalone Organization entity', () => {
    const schema = generateBlogPostSchema({
      ...baseBlogSchemaInput,
      publisher: {
        ...baseBlogSchemaInput.publisher,
        id: 'https://ogabassey.com#organization',
      },
    });

    expect((schema.publisher as Record<string, unknown>)['@id']).toBe(
      'https://ogabassey.com#organization'
    );
  });

  it('preserves ampersands in blog sameAs URLs until JSON-LD serialization', () => {
    const sameAsUrl = 'https://www.linkedin.com/in/editor?ref=a&source=b';
    const schema = generateBlogPostSchema({
      ...baseBlogSchemaInput,
      author: {
        ...baseBlogSchemaInput.author,
        sameAs: [sameAsUrl],
      },
      publisher: {
        ...baseBlogSchemaInput.publisher,
        sameAs: [sameAsUrl],
      },
    });

    expect((schema.author as Record<string, unknown>).sameAs).toEqual([
      sameAsUrl,
    ]);
    expect((schema.publisher as Record<string, unknown>).sameAs).toEqual([
      sameAsUrl,
    ]);

    const parsed = JSON.parse(safeJsonLdStringify(schema)) as Record<
      string,
      Record<string, unknown>
    >;
    expect(parsed.author.sameAs).toEqual([sameAsUrl]);
    expect(parsed.publisher.sameAs).toEqual([sameAsUrl]);
  });

  it('ignores non-string and unsafe blog sameAs entries without crashing', () => {
    const schema = generateBlogPostSchema({
      ...baseBlogSchemaInput,
      author: {
        ...baseBlogSchemaInput.author,
        sameAs: [
          ' https://www.linkedin.com/in/editor ',
          null,
          42,
          'javascript:alert(1)',
        ],
      },
      publisher: {
        ...baseBlogSchemaInput.publisher,
        sameAs: [undefined, 'https://www.instagram.com/ogabassey/'],
      },
    });

    expect((schema.author as Record<string, unknown>).sameAs).toEqual([
      'https://www.linkedin.com/in/editor',
    ]);
    expect((schema.publisher as Record<string, unknown>).sameAs).toEqual([
      'https://www.instagram.com/ogabassey/',
    ]);
  });

  it('omits image markup when no representative image is supplied', () => {
    const schema = generateBlogPostSchema(baseBlogSchemaInput);

    expect(schema).not.toHaveProperty('image');
  });
});

describe('getValidatedProductUrl', () => {
  const expectedPixelUrl = 'https://store.example.com/smartphones/pixel-10';

  it('reuses a matching canonical URL after normalizing it to the storefront origin', () => {
    const url = getValidatedProductUrl(
      makeProduct({
        slug: 'pixel-10',
        category_slug: 'smartphones',
        canonical_url: 'https://usebaci.com/smartphones/pixel-10',
      }),
      'https://store.example.com',
      'teststore'
    );

    expect(url).toBe(expectedPixelUrl);
  });

  it('rejects stored canonical URLs with query strings or fragments', () => {
    const url = getValidatedProductUrl(
      makeProduct({
        slug: 'pixel-10',
        category_slug: 'smartphones',
        canonical_url:
          'https://store.example.com/smartphones/pixel-10?utm_source=google#reviews',
      }),
      'https://store.example.com',
      'teststore'
    );

    expect(url).toBe(expectedPixelUrl);
  });

  it('rejects stored canonical URLs whose path no longer matches the product route', () => {
    const url = getValidatedProductUrl(
      makeProduct({
        slug: 'pixel-10',
        category_slug: 'smartphones',
        canonical_url: 'https://store.example.com/products/pixel-10',
      }),
      'https://store.example.com',
      'teststore'
    );

    expect(url).toBe(expectedPixelUrl);
  });

  it('falls back to the slug route when canonical_url is undefined', () => {
    const url = getValidatedProductUrl(
      makeProduct({
        slug: 'pixel-10',
        category_slug: 'smartphones',
        canonical_url: undefined,
      }),
      'https://store.example.com',
      'teststore'
    );

    expect(url).toBe(expectedPixelUrl);
  });

  it('falls back to the slug route when canonical_url is null', () => {
    const url = getValidatedProductUrl(
      {
        ...makeProduct({
          slug: 'pixel-10',
          category_slug: 'smartphones',
        }),
        // Intentional null override: runtime/external data can bypass Product typing.
        canonical_url: null,
      },
      'https://store.example.com',
      'teststore'
    );

    expect(url).toBe(expectedPixelUrl);
  });

  it('falls back to the slug route when canonical_url is malformed', () => {
    const url = getValidatedProductUrl(
      makeProduct({
        slug: 'pixel-10',
        category_slug: 'smartphones',
        canonical_url: 'https://[invalid',
      }),
      'https://store.example.com',
      'teststore'
    );

    expect(url).toBe(expectedPixelUrl);
  });

  it('falls back to the relative slug route when storeOrigin is empty', () => {
    const url = getValidatedProductUrl(
      makeProduct({
        slug: 'pixel-10',
        category_slug: 'smartphones',
      }),
      '',
      'teststore'
    );

    expect(url).toBe('/smartphones/pixel-10');
  });

  it('falls back to the relative slug route when storeOrigin is malformed', () => {
    const url = getValidatedProductUrl(
      makeProduct({
        slug: 'pixel-10',
        category_slug: 'smartphones',
      }),
      'https://[invalid',
      'teststore'
    );

    expect(url).toBe('/smartphones/pixel-10');
  });

  it('falls back to the slug route when same-origin canonical points to a different non-product path', () => {
    const url = getValidatedProductUrl(
      makeProduct({
        slug: 'pixel-10',
        category_slug: 'smartphones',
        canonical_url: 'https://store.example.com/sale',
      }),
      'https://store.example.com',
      'teststore'
    );

    expect(url).toBe(expectedPixelUrl);
  });
});

describe('generateBreadcrumbSchema', () => {
  it('emits breadcrumb items as schema objects with absolute ids', () => {
    const schema = generateBreadcrumbSchema([
      { name: 'Ogabassey', url: 'https://ogabassey.com' },
      { name: 'Smartphones', url: 'https://ogabassey.com/smartphones' },
    ]);

    expect(schema).toEqual({
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        {
          '@type': 'ListItem',
          position: 1,
          name: 'Ogabassey',
          item: 'https://ogabassey.com/',
        },
        {
          '@type': 'ListItem',
          position: 2,
          name: 'Smartphones',
          item: 'https://ogabassey.com/smartphones',
        },
      ],
    });
  });

  it('falls back to a root item URL when the caller passes an empty breadcrumb url', () => {
    const schema = generateBreadcrumbSchema([
      { name: 'Home', url: '' },
      { name: 'Gaming Accessories', url: '/gaming-accessories' },
    ]);

    expect(schema).toEqual({
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        {
          '@type': 'ListItem',
          position: 1,
          name: 'Home',
          item: '/',
        },
        {
          '@type': 'ListItem',
          position: 2,
          name: 'Gaming Accessories',
          item: '/gaming-accessories',
        },
      ],
    });
  });
});

describe('generateCollectionPageSchema', () => {
  it('converts product and image URLs to absolute schema URLs', () => {
    const schema = generateCollectionPageSchema({
      name: 'Smartphones',
      description: 'Shop smartphones',
      url: 'https://ogabassey.com/smartphones',
      merchantName: 'Ogabassey',
      currency: 'NGN',
      products: [
        makeProduct({
          name: 'iPhone 16',
          slug: 'iphone-16',
          category: 'Smartphones',
          image: '/images/iphone-16.jpg',
          imageLarge: '/images/iphone-16-large.jpg',
        }),
      ],
    });

    const listItem = (
      (schema.mainEntity as Record<string, unknown>).itemListElement as Record<
        string,
        unknown
      >[]
    )[0];
    const product = listItem.item as Record<string, unknown>;
    const offers = product.offers as Record<string, unknown>;

    expect(schema.url).toBe('https://ogabassey.com/smartphones');
    expect(product.url).toBe('https://ogabassey.com/smartphones/iphone-16');
    expect(product.image).toEqual([
      'https://ogabassey.com/images/iphone-16-large.jpg',
    ]);
    expect(offers.url).toBe('https://ogabassey.com/smartphones/iphone-16');
  });

  it('omits placeholder-only products from collection-page Product JSON-LD', () => {
    const schema = generateCollectionPageSchema({
      name: 'Smartphones',
      description: 'Shop smartphones',
      url: 'https://ogabassey.com/smartphones',
      merchantName: 'Ogabassey',
      currency: 'NGN',
      products: [
        makeProduct({
          name: 'No Image Phone',
          slug: 'no-image-phone',
          category: 'Smartphones',
          image: '/placeholder.svg',
          imageLarge: '/placeholder.svg',
        }),
      ],
    });

    const itemList = schema.mainEntity as Record<string, unknown>;

    expect(itemList.numberOfItems).toBe(0);
    expect(itemList.itemListElement).toEqual([]);
  });

  it('omits external placeholder-only products from collection-page Product JSON-LD', () => {
    const schema = generateCollectionPageSchema({
      name: 'Smartphones',
      description: 'Shop smartphones',
      url: 'https://ogabassey.com/smartphones',
      merchantName: 'Ogabassey',
      currency: 'NGN',
      products: [
        makeProduct({
          name: 'External Placeholder Phone',
          slug: 'external-placeholder-phone',
          category: 'Smartphones',
          image: 'https://placehold.co/400x400/f8fafc/94a3b8?text=No+Image',
          imageLarge: 'https://via.placeholder.com/800x800?text=No+Image',
        }),
      ],
    });

    const itemList = schema.mainEntity as Record<string, unknown>;

    expect(itemList.numberOfItems).toBe(0);
    expect(itemList.itemListElement).toEqual([]);
  });

  it('normalizes OgaBassey CDN image URL shapes in collection-page Product JSON-LD', () => {
    const schema = generateCollectionPageSchema({
      name: 'Smartphones',
      description: 'Shop smartphones',
      url: 'https://ogabassey.com/smartphones',
      merchantName: 'Ogabassey',
      currency: 'NGN',
      products: [
        makeProduct({
          name: 'Legacy Image Phone',
          slug: 'legacy-image-phone',
          category: 'Smartphones',
          image: 'https://cdn.ogabassey.com/products/legacy-phone.avif',
          imageLarge:
            'https://cdn.ogabassey.com/image/width=750,quality=75,format=auto/core-assets/products/legacy-phone-large.avif',
        }),
      ],
    });

    const listItem = (
      (schema.mainEntity as Record<string, unknown>).itemListElement as Record<
        string,
        unknown
      >[]
    )[0];
    const product = listItem.item as Record<string, unknown>;

    expect(product.image).toEqual([
      'https://cdn.ogabassey.com/core-assets/products/legacy-phone-large.avif',
    ]);
  });

  it('normalizes legacy collection-page product image URLs when imageLarge is unavailable', () => {
    const schema = generateCollectionPageSchema({
      name: 'Smartphones',
      description: 'Shop smartphones',
      url: 'https://ogabassey.com/smartphones',
      merchantName: 'Ogabassey',
      currency: 'NGN',
      products: [
        (() => {
          const product = makeProduct({
            name: 'Legacy Image Phone',
            slug: 'legacy-image-phone',
            category: 'Smartphones',
            image: 'https://cdn.ogabassey.com/products/legacy-phone.avif',
          });
          delete (product as Partial<Product>).imageLarge;
          return product;
        })(),
      ],
    });

    const listItem = (
      (schema.mainEntity as Record<string, unknown>).itemListElement as Record<
        string,
        unknown
      >[]
    )[0];
    const product = listItem.item as Record<string, unknown>;

    expect(product.image).toEqual([
      'https://cdn.ogabassey.com/core-assets/products/legacy-phone.avif',
    ]);
  });

  it('omits products without image candidates from collection-page Product JSON-LD', () => {
    const productWithoutImageCandidates = makeProduct({
      id: 'no-image-candidates-product',
      name: 'No Candidate Phone',
      slug: 'no-candidate-phone',
      category: 'Smartphones',
    });
    delete (productWithoutImageCandidates as Partial<Product>).image;
    delete (productWithoutImageCandidates as Partial<Product>).imageLarge;

    const schema = generateCollectionPageSchema({
      name: 'Smartphones',
      description: 'Shop smartphones',
      url: 'https://ogabassey.com/smartphones',
      merchantName: 'Ogabassey',
      currency: 'NGN',
      products: [productWithoutImageCandidates],
    });

    const itemList = schema.mainEntity as Record<string, unknown>;

    expect(itemList.numberOfItems).toBe(0);
    expect(itemList.itemListElement).toEqual([]);
  });

  it('keeps contiguous positions when placeholder products are filtered from collection-page JSON-LD', () => {
    const schema = generateCollectionPageSchema({
      name: 'Smartphones',
      description: 'Shop smartphones',
      url: 'https://ogabassey.com/smartphones',
      merchantName: 'Ogabassey',
      currency: 'NGN',
      products: [
        makeProduct({
          id: 'placeholder-product',
          name: 'No Image Phone',
          slug: 'no-image-phone',
          category: 'Smartphones',
          image: '/placeholder.svg',
          imageLarge: '/placeholder.svg',
        }),
        makeProduct({
          id: 'real-image-product',
          name: 'Phone With Image',
          slug: 'phone-with-image',
          category: 'Smartphones',
          image: '/images/phone-with-image.jpg',
          imageLarge: '/images/phone-with-image-large.jpg',
        }),
      ],
    });

    const itemList = schema.mainEntity as Record<string, unknown>;
    const itemListElement = itemList.itemListElement as Record<
      string,
      unknown
    >[];
    const product = itemListElement[0]?.item as Record<string, unknown>;

    expect(itemList.numberOfItems).toBe(1);
    expect(itemListElement).toHaveLength(1);
    expect(itemListElement[0]?.position).toBe(1);
    expect(product.name).toBe('Phone With Image');
    expect(product.image).toEqual([
      'https://ogabassey.com/images/phone-with-image-large.jpg',
    ]);
  });

  it('filters invalid collection products before applying the Product JSON-LD cap', () => {
    const products = [
      ...Array.from({ length: 20 }, (_, index) =>
        makeProduct({
          id: `placeholder-product-${index}`,
          name: `Placeholder Phone ${index + 1}`,
          slug: `placeholder-phone-${index + 1}`,
          category: 'Smartphones',
          image: '/placeholder.svg',
          imageLarge: '/placeholder.svg',
        })
      ),
      ...Array.from({ length: 21 }, (_, index) =>
        makeProduct({
          id: `valid-product-${index}`,
          name: `Valid Phone ${index + 1}`,
          slug: `valid-phone-${index + 1}`,
          category: 'Smartphones',
          image: `/images/valid-phone-${index + 1}.jpg`,
          imageLarge: `/images/valid-phone-${index + 1}-large.jpg`,
        })
      ),
    ];

    const schema = generateCollectionPageSchema({
      name: 'Smartphones',
      description: 'Shop smartphones',
      url: 'https://ogabassey.com/smartphones',
      merchantName: 'Ogabassey',
      currency: 'NGN',
      products,
    });

    const itemList = schema.mainEntity as Record<string, unknown>;
    const itemListElement = itemList.itemListElement as Record<
      string,
      unknown
    >[];
    const emittedProducts = itemListElement.map(
      (listItem) => listItem.item as Record<string, unknown>
    );

    expect(itemList.numberOfItems).toBe(20);
    expect(itemListElement).toHaveLength(20);
    expect(itemListElement.map((listItem) => listItem.position)).toEqual(
      Array.from({ length: 20 }, (_, index) => index + 1)
    );
    expect(emittedProducts.map((product) => product.name)).toEqual(
      Array.from({ length: 20 }, (_, index) => `Valid Phone ${index + 1}`)
    );
    expect(emittedProducts[0]?.image).toEqual([
      'https://ogabassey.com/images/valid-phone-1-large.jpg',
    ]);
    expect(emittedProducts[19]?.image).toEqual([
      'https://ogabassey.com/images/valid-phone-20-large.jpg',
    ]);
  });

  it('falls back to a real image when imageLarge is the local placeholder', () => {
    const schema = generateCollectionPageSchema({
      name: 'Smartphones',
      description: 'Shop smartphones',
      url: 'https://ogabassey.com/smartphones',
      merchantName: 'Ogabassey',
      currency: 'NGN',
      products: [
        makeProduct({
          name: 'Phone With Image',
          slug: 'phone-with-image',
          category: 'Smartphones',
          image: '/images/phone-with-image.jpg',
          imageLarge: 'https://ogabassey.com/placeholder.svg?cache=1',
        }),
      ],
    });

    const listItem = (
      (schema.mainEntity as Record<string, unknown>).itemListElement as Record<
        string,
        unknown
      >[]
    )[0];
    const product = listItem.item as Record<string, unknown>;

    expect(product.image).toEqual([
      'https://ogabassey.com/images/phone-with-image.jpg',
    ]);
  });

  it('falls back to a real image when imageLarge is an external placeholder', () => {
    const schema = generateCollectionPageSchema({
      name: 'Smartphones',
      description: 'Shop smartphones',
      url: 'https://ogabassey.com/smartphones',
      merchantName: 'Ogabassey',
      currency: 'NGN',
      products: [
        makeProduct({
          name: 'Phone With Image',
          slug: 'phone-with-image',
          category: 'Smartphones',
          image: '/images/phone-with-image.jpg',
          imageLarge: 'https://placehold.it/800x800?text=No+Image',
        }),
      ],
    });

    const listItem = (
      (schema.mainEntity as Record<string, unknown>).itemListElement as Record<
        string,
        unknown
      >[]
    )[0];
    const product = listItem.item as Record<string, unknown>;

    expect(product.image).toEqual([
      'https://ogabassey.com/images/phone-with-image.jpg',
    ]);
  });

  it('omits the page url when the collection URL cannot be normalized', () => {
    const schema = generateCollectionPageSchema({
      name: 'Smartphones',
      description: 'Shop smartphones',
      url: 'not-a-valid-url',
      merchantName: 'Ogabassey',
      currency: 'NGN',
      products: [],
    });

    expect(schema.url).toBeUndefined();
  });

  it('preserves query parameters in JSON-LD URL fields without HTML escaping', () => {
    const schema = generateCollectionPageSchema({
      name: 'Smartphones',
      description: 'Shop smartphones',
      url: 'https://ogabassey.com/smartphones?sort=popular&ref=home',
      merchantName: 'Ogabassey',
      currency: 'NGN',
      products: [
        makeProduct({
          name: 'iPhone 16',
          slug: 'iphone-16',
          category: 'Smartphones',
          image: '/images/iphone-16.jpg?fit=cover&width=600',
          imageLarge: '/images/iphone-16-large.jpg?fit=cover&width=1200',
        }),
      ],
    });

    const listItem = (
      (schema.mainEntity as Record<string, unknown>).itemListElement as Record<
        string,
        unknown
      >[]
    )[0];
    const product = listItem.item as Record<string, unknown>;

    expect(schema.url).toBe(
      'https://ogabassey.com/smartphones?sort=popular&ref=home'
    );
    expect(product.image).toEqual([
      'https://ogabassey.com/images/iphone-16-large.jpg?fit=cover&width=1200',
    ]);
  });

  it('includes brand and identifiers on collection-page product offers and omits per-item shipping and return policy', () => {
    const schema = generateCollectionPageSchema({
      name: 'Smartphones',
      description: 'Shop smartphones',
      url: 'https://ogabassey.com/smartphones',
      merchantName: 'Ogabassey',
      currency: 'NGN',
      country: 'NG',
      trustProfile: makeTrustProfile({
        returnPolicy: {
          summary: 'Returns accepted within 10 days.',
          windowDays: 10,
          returnMethod: 'mail',
          returnFees: 'free',
          localRoute: '/returns',
        },
        shippingPolicy: {
          summary: 'Ships nationwide.',
          regions: ['NG'],
          handlingDaysMin: 1,
          handlingDaysMax: 2,
          transitDaysMin: 2,
          transitDaysMax: 4,
          shippingFeeType: 'free',
          localRoute: '/shipping',
        },
      }),
      products: [
        makeProduct({
          name: 'Galaxy S25 Edge',
          brand: 'Samsung',
          gtin: '0123456789012',
          image: '/images/galaxy-s25-edge.jpg',
        }),
      ],
    });

    const listItem = (
      (schema.mainEntity as Record<string, unknown>).itemListElement as Record<
        string,
        unknown
      >[]
    )[0];
    const product = listItem.item as Record<string, unknown>;
    const offer = product.offers as Record<string, unknown>;
    const brand = product.brand as Record<string, unknown>;

    expect(brand).toEqual({
      '@type': 'Brand',
      name: 'Samsung',
    });
    expect(product.gtin).toBe('0123456789012');
    expect(offer.shippingDetails).toBeUndefined();
    expect(offer.hasMerchantReturnPolicy).toBeUndefined();
  });

  it('keeps unmanaged products InStock in collection offers', () => {
    const schema = generateCollectionPageSchema({
      name: 'Smartphones',
      description: 'Shop smartphones',
      url: 'https://ogabassey.com/smartphones',
      merchantName: 'Ogabassey',
      currency: 'NGN',
      products: [
        makeProduct({
          name: 'Galaxy S25',
          manage_stock: false,
          stock: 0,
        }),
      ],
    });

    const listItem = (
      (schema.mainEntity as Record<string, unknown>).itemListElement as Record<
        string,
        unknown
      >[]
    )[0];
    const product = listItem.item as Record<string, unknown>;
    const offer = product.offers as Record<string, unknown>;

    expect(offer.availability).toBe('https://schema.org/InStock');
  });

  it('stores numberOfItems on ItemList (not CollectionPage)', () => {
    const schema = generateCollectionPageSchema({
      name: 'Smartphones',
      description: 'Shop smartphones',
      url: 'https://ogabassey.com/smartphones',
      merchantName: 'Ogabassey',
      currency: 'NGN',
      products: [
        makeProduct({ name: 'Galaxy S25' }),
        makeProduct({ id: 'p2', name: 'iPhone 16' }),
      ],
    });

    const itemList = schema.mainEntity as Record<string, unknown>;

    expect(schema).not.toHaveProperty('numberOfItems');
    expect(itemList.numberOfItems).toBe(2);
  });
});

describe('generateProductSchema - condition mapping', () => {
  it('maps open_box product conditions to RefurbishedCondition', () => {
    const schema = generateProductSchema(
      makeProduct({ condition: 'open_box' }),
      'TestStore',
      'NGN',
      'NG'
    );

    expect((schema.offers as Record<string, unknown>).itemCondition).toBe(
      'https://schema.org/RefurbishedCondition'
    );
  });

  it('does not default unsupported non-empty product conditions to NewCondition', () => {
    const schema = generateProductSchema(
      makeProduct({
        // Cast required: simulating an unknown value coming from external data.
        condition: 'premium_used' as Product['condition'],
      }),
      'TestStore',
      'NGN',
      'NG'
    );

    expect(
      (schema.offers as Record<string, unknown>).itemCondition
    ).toBeUndefined();
  });

  it('maps open_box offer conditions to RefurbishedCondition', () => {
    const schema = generateProductSchema(
      makeProduct({
        has_condition_offers: true,
        offers: [
          {
            id: 'offer-open-box',
            condition: 'open_box',
            price: 500000,
            stock_quantity: 3,
          },
        ],
      }),
      'TestStore',
      'NGN',
      'NG'
    );

    expect(
      (
        (schema.offers as Record<string, unknown>[])[0] as Record<
          string,
          unknown
        >
      ).itemCondition
    ).toBe('https://schema.org/RefurbishedCondition');
  });

  it('maps per-variant offer conditions independently inside ProductGroup schema', () => {
    const schema = generateProductSchema(
      makeProduct({
        condition: 'new',
        variants: [
          {
            id: 'variant-open-box',
            product_id: 'test-123',
            merchant_id: 'm1',
            condition: 'open_box',
            attributes: { storage: '128GB' },
            price_override: 500000,
            stock_quantity: 3,
          },
          {
            id: 'variant-new',
            product_id: 'test-123',
            merchant_id: 'm1',
            condition: 'new',
            attributes: { storage: '256GB' },
            price_override: 650000,
            stock_quantity: 5,
          },
        ],
      }),
      'TestStore',
      'NGN',
      'NG'
    );

    const variants = schema.hasVariant as Record<string, unknown>[];
    const firstOffer = variants[0]?.offers as Record<string, unknown>;
    const secondOffer = variants[1]?.offers as Record<string, unknown>;

    expect(firstOffer.itemCondition).toBe(
      'https://schema.org/RefurbishedCondition'
    );
    expect(secondOffer.itemCondition).toBe('https://schema.org/NewCondition');
  });

  it('keeps condition offers as InStock when manage_stock is disabled', () => {
    const schema = generateProductSchema(
      makeProduct({
        manage_stock: false,
        has_condition_offers: true,
        offers: [
          {
            id: 'offer-unmanaged',
            condition: 'new',
            price: 500000,
            stock_quantity: 0,
          },
        ],
      }),
      'TestStore',
      'NGN',
      'NG'
    );

    const availability = (
      (schema.offers as Record<string, unknown>[])[0] as Record<string, unknown>
    ).availability;

    expect(availability).toBe('https://schema.org/InStock');
  });

  it('keeps variant offers as InStock when manage_stock is disabled', () => {
    const schema = generateProductSchema(
      makeProduct({
        manage_stock: false,
        has_variants: true,
        variants: [
          {
            id: 'variant-unmanaged',
            product_id: 'test-123',
            merchant_id: 'm1',
            condition: 'new',
            attributes: { storage: '128GB' },
            price_override: 500000,
            stock_quantity: 0,
          },
        ],
      }),
      'TestStore',
      'NGN',
      'NG'
    );

    const variants = schema.hasVariant as Record<string, unknown>[];
    const availability = (variants[0]?.offers as Record<string, unknown>)
      .availability;

    expect(availability).toBe('https://schema.org/InStock');
  });
});

describe('generateSlug', () => {
  it('should convert a simple string to a slug', () => {
    expect(generateSlug('Hello World')).toBe('hello-world');
  });

  it('should handle strings with multiple spaces', () => {
    expect(generateSlug('Hello   World')).toBe('hello-world');
  });

  it('should remove special characters', () => {
    expect(generateSlug('Hello World!@#$%^&*()')).toBe('hello-world');
  });

  it('should handle leading and trailing spaces', () => {
    expect(generateSlug('  Hello World  ')).toBe('hello-world');
  });

  it('should handle leading and trailing dashes', () => {
    expect(generateSlug('--Hello-World--')).toBe('hello-world');
  });

  it('should handle multiple dashes in a row', () => {
    expect(generateSlug('Hello--World')).toBe('hello-world');
  });

  it('should handle an empty string', () => {
    expect(generateSlug('')).toBe('');
  });
});

describe('getProductUrl — canonical metadata path guards', () => {
  it('reuses canonical product paths only when they match supported product routes', () => {
    expect(
      getProductUrl({
        id: 'test-123',
        name: 'Canon Phone',
        slug: 'canon-phone',
        canonical_url: 'https://store.example.com/products/canon-phone',
      })
    ).toBe('/products/canon-phone');

    expect(
      getProductUrl({
        id: 'test-123',
        name: 'Canon Phone',
        slug: 'canon-phone',
        categorySlug: 'smartphones',
        canonical_url: 'https://store.example.com/sale',
      })
    ).toBe('/smartphones/canon-phone');

    expect(
      getProductUrl({
        id: 'test-123',
        name: 'Canon Phone',
        slug: 'canon-phone',
        categorySlug: 'smartphones',
        canonical_url: 'https://store.example.com/blog/canon-phone',
      })
    ).toBe('/smartphones/canon-phone');
  });

  it('ignores canonical URLs that point at sitemap-like metadata roots', () => {
    const metadataCanonicals = [
      'https://store.example.com/sitemap/products.xml',
      'https://store.example.com/sitemap.xml',
      'https://store.example.com/robots.txt',
      'https://store.example.com/manifest/app.webmanifest',
      'https://store.example.com/opengraph-image/canon-phone',
      'https://store.example.com/rss/canon-phone',
      'https://store.example.com/api/canon-phone',
    ];

    for (const canonicalUrl of metadataCanonicals) {
      expect(
        getProductUrl({
          id: 'test-123',
          name: 'Canon Phone',
          slug: 'canon-phone',
          categorySlug: 'smartphones',
          canonical_url: canonicalUrl,
        })
      ).toBe('/smartphones/canon-phone');
    }
  });
});

describe('getEffectiveProductStock', () => {
  it('uses stock_quantity when it reflects the current positive stock', () => {
    expect(
      getEffectiveProductStock({
        stock: 0,
        stock_quantity: 4,
      })
    ).toBe(4);
  });

  it('falls back to legacy stock when stock_quantity drifted to zero', () => {
    expect(
      getEffectiveProductStock({
        stock: 12,
        stock_quantity: 0,
      })
    ).toBe(12);
  });

  it('falls back to legacy stock when stock_quantity is missing', () => {
    expect(
      getEffectiveProductStock({
        stock: 7,
        stock_quantity: null,
      })
    ).toBe(7);
  });
});

describe('buildProductUrl — preserves raw category slug (no alias remap)', () => {
  // Regression tests: the product detail route redirects when the URL
  // category segment does not match the product's stored `category_slug`
  // (see apps/web/src/app/(storefront)/[slug]/(catalog)/[category]/[productSlug]/page.tsx).
  // If the canonical URL builder remapped legacy slugs (e.g. `phones` ->
  // `smartphones`), products with those legacy slugs would permanently
  // redirect to the normalized URL, which then mismatches the raw DB slug
  // and redirects again — a self-redirect loop. The builder must therefore
  // preserve the merchant's stored slug verbatim (aside from trim/lowercase).

  it('preserves `phones` without remapping to `smartphones`', () => {
    expect(buildProductUrl('iphone-12', null, 'phones')).toBe(
      '/phones/iphone-12'
    );
  });

  it('preserves `macbook` without remapping to `laptops`', () => {
    expect(buildProductUrl('macbook-air-m2', null, 'macbook')).toBe(
      '/macbook/macbook-air-m2'
    );
  });

  it('preserves `samsung` without remapping to `smartphones`', () => {
    expect(buildProductUrl('galaxy-s23', null, 'samsung')).toBe(
      '/samsung/galaxy-s23'
    );
  });

  it('preserves `accesories` typo verbatim (DB slug is source of truth)', () => {
    expect(buildProductUrl('usb-cable', null, 'accesories')).toBe(
      '/accesories/usb-cable'
    );
  });

  it('lowercases and trims the category slug', () => {
    expect(buildProductUrl('item', null, '  Gaming  ')).toBe('/gaming/item');
  });

  it('falls back to /products/{slug} when no category is provided', () => {
    expect(buildProductUrl('generic-item', null, null)).toBe(
      '/products/generic-item'
    );
  });

  it('preserves raw slug when category passed as object', () => {
    expect(
      buildProductUrl('iphone-12', { name: 'Phones', slug: 'phones' })
    ).toBe('/phones/iphone-12');
  });

  it('prefers object category slug over fallback categorySlug arg', () => {
    expect(
      buildProductUrl(
        'iphone-12',
        { name: 'Phones', slug: 'phones' },
        'ignored'
      )
    ).toBe('/phones/iphone-12');
  });
});

describe('getProductUrl — no self-redirect loop for legacy-slug products', () => {
  it('builds canonical URL matching the stored DB category_slug', () => {
    // Simulate a product whose DB category_slug is the legacy alias.
    // The canonical URL must use the raw slug so the product route's
    // category-mismatch check (raw DB slug vs URL segment) does not fire.
    const url = getProductUrl({
      id: 'p1',
      name: 'iPhone 12',
      slug: 'iphone-12',
      categories: { name: 'Phones', slug: 'phones' },
      category_slug: 'phones',
    });
    expect(url).toBe('/phones/iphone-12');
  });

  it('respects an explicit canonical_url without alias-remapping it', () => {
    const url = getProductUrl({
      id: 'p2',
      name: 'MacBook Air',
      slug: 'macbook-air-m2',
      canonical_url: 'https://store.example.com/macbook/macbook-air-m2',
    });
    expect(url).toBe('/macbook/macbook-air-m2');
  });
});
