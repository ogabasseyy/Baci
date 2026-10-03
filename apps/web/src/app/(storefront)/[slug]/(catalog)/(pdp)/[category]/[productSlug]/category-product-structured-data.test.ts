import { describe, expect, it } from 'vitest';
import type { Product } from '@/lib/products';
import { makeSeoProduct } from '@/lib/seo-utils-product-schema-test-helper';
import { buildMerchantTrustProfile } from '@/lib/storefront-trust/build-merchant-trust-profile';
import { buildCategoryProductStructuredData } from './category-product-structured-data';

const baseUrl = 'https://shop.example.com';
const merchant = {
  business_name: 'Example Store',
  slug: 'example-store',
  country: 'NG',
  logo_url: 'https://shop.example.com/logo.png',
};

function build(productOverrides: Partial<Product> = {}) {
  return buildCategoryProductStructuredData({
    product: makeSeoProduct({
      slug: 'test-product',
      category: 'Phones',
      category_slug: 'phones',
      ...productOverrides,
    }),
    merchant,
    baseUrl,
    currency: 'NGN',
    trustProfile: buildMerchantTrustProfile({}, baseUrl),
    acceptedPaymentMethods: ['Bank transfer'],
  });
}

describe('category PDP structured data assembly', () => {
  it('keeps the product offer and final breadcrumb on the same public URL', () => {
    const { productSchema, breadcrumbSchema } = build();
    expect(productSchema.offers).toMatchObject({
      price: 100,
      priceCurrency: 'NGN',
      url: `${baseUrl}/phones/test-product`,
      acceptedPaymentMethod: ['https://schema.org/ByBankTransferInAdvance'],
    });
    expect(breadcrumbSchema.itemListElement).toEqual([
      expect.objectContaining({ name: 'Example Store', item: `${baseUrl}/` }),
      expect.objectContaining({ name: 'Phones', item: `${baseUrl}/phones` }),
      expect.objectContaining({
        name: 'Test Product',
        item: `${baseUrl}/phones/test-product`,
      }),
    ]);
  });

  it('uses the products collection when a product has no category', () => {
    const { breadcrumbSchema } = build({
      category: undefined,
      category_slug: undefined,
    });
    expect(breadcrumbSchema.itemListElement).toContainEqual(
      expect.objectContaining({
        name: 'All Products',
        item: `${baseUrl}/products`,
      })
    );
  });

  it('retains individual variant prices, stock and conditions in ProductGroup offers', () => {
    const { productSchema } = build({
      variants: [
        {
          id: 'used-black',
          product_id: 'test-123',
          merchant_id: 'm1',
          attributes: { color: 'Black' },
          condition: 'used',
          price_override: 80,
          stock_quantity: 0,
        },
        {
          id: 'new-white',
          product_id: 'test-123',
          merchant_id: 'm1',
          attributes: { color: 'White' },
          condition: 'new',
          price_override: 120,
          stock_quantity: 3,
        },
      ],
    });
    expect(productSchema['@type']).toBe('ProductGroup');
    expect(productSchema.hasVariant).toEqual([
      expect.objectContaining({
        color: 'Black',
        offers: expect.objectContaining({
          price: 80,
          priceCurrency: 'NGN',
          availability: 'https://schema.org/OutOfStock',
          itemCondition: 'https://schema.org/UsedCondition',
        }),
      }),
      expect.objectContaining({
        color: 'White',
        offers: expect.objectContaining({
          price: 120,
          availability: 'https://schema.org/InStock',
          itemCondition: 'https://schema.org/NewCondition',
        }),
      }),
    ]);
  });
});
