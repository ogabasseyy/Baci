import { describe, expect, it } from 'vitest';
import {
  buildComparePageSchemas,
  buildPriceBandPageSchemas,
  buildProductCompareItemListSchema,
} from './compare-schema';

describe('buildComparePageSchemas', () => {
  it('keeps FAQPage schema suppressed even when the compare page has FAQ items', () => {
    const schemas = buildComparePageSchemas({
      breadcrumbItems: [
        { name: 'Ogabassey', url: 'https://ogabassey.com' },
        { name: 'Smartphones', url: 'https://ogabassey.com/smartphones' },
      ],
      faqItems: [
        {
          question: 'Which phone is better?',
          answer: 'It depends on the buyer.',
        },
      ],
    });

    expect(schemas.breadcrumb['@type']).toBe('BreadcrumbList');
    expect(schemas.faq).toBeNull();
  });

  it('omits FAQPage schema when the compare page has no FAQ items', () => {
    const schemas = buildComparePageSchemas({
      breadcrumbItems: [{ name: 'Ogabassey', url: 'https://ogabassey.com' }],
      faqItems: [],
    });

    expect(schemas.breadcrumb['@type']).toBe('BreadcrumbList');
    expect(schemas.faq).toBeNull();
  });
});

describe('buildProductCompareItemListSchema', () => {
  it('builds Product ItemList schema with additional compared properties', () => {
    const schema = buildProductCompareItemListSchema({
      pageName: 'iPhone 17 Pro Max vs Samsung Galaxy Z TriFold',
      pageUrl:
        'https://ogabassey.com/smartphones/compare/iphone-17-pro-max-vs-samsung-galaxy-z-trifold',
      currency: 'NGN',
      products: [
        {
          id: 'product-a',
          slug: 'iphone-17-pro-max',
          name: 'iPhone 17 Pro Max',
          category_slug: 'smartphones',
          price: 2_200_000,
          description: '<p>Apple flagship.</p>',
        },
        {
          id: 'product-b',
          slug: 'samsung-galaxy-z-trifold',
          name: 'Samsung Galaxy Z TriFold',
          category_slug: 'smartphones',
          price: 2_300_000,
        },
      ],
      comparisonMatrix: {
        columns: [
          { productId: 'product-a', label: 'iPhone 17 Pro Max' },
          { productId: 'product-b', label: 'Samsung Galaxy Z TriFold' },
        ],
        groups: [],
        flatRows: [
          {
            label: 'Chipset',
            values: ['A19 Pro', 'Snapdragon 8 Elite'],
            isDifferent: true,
          },
        ],
        differentiatingRowCount: 1,
      },
    });

    expect(schema['@type']).toBe('ItemList');
    expect(
      (
        schema.itemListElement as Array<{
          item: {
            additionalProperty: Array<{ name: string; value: string }>;
            offers: { priceCurrency: string };
          };
        }>
      )[0]?.item.additionalProperty[0]
    ).toMatchObject({ name: 'Chipset', value: 'A19 Pro' });
    expect(
      (
        schema.itemListElement as Array<{
          item: { offers: { priceCurrency: string } };
        }>
      )[0]?.item.offers.priceCurrency
    ).toBe('NGN');
    expect(
      (
        schema.itemListElement as Array<{
          item: { offers: Record<string, unknown> };
        }>
      )[0]?.item.offers
    ).not.toHaveProperty('availability');
  });

  it('uses canonical and joined-category routing fields for Product URLs', () => {
    const schema = buildProductCompareItemListSchema({
      pageName: 'Galaxy S25 vs Pixel 10',
      pageUrl:
        'https://ogabassey.com/smartphones/compare/galaxy-s25-vs-pixel-10',
      currency: 'NGN',
      products: [
        {
          id: 'product-a',
          slug: 'galaxy-s25',
          name: 'Galaxy S25',
          canonical_url: 'https://ogabassey.com/smartphones/galaxy-s25',
        },
        {
          id: 'product-b',
          slug: 'pixel-10',
          name: 'Pixel 10',
          categories: { name: 'Smartphones', slug: 'smartphones' },
        },
      ],
    });

    const products = schema.itemListElement as Array<{
      item: { url: string };
    }>;

    expect(products[0]?.item.url).toBe(
      'https://ogabassey.com/smartphones/galaxy-s25'
    );
    expect(products[1]?.item.url).toBe(
      'https://ogabassey.com/smartphones/pixel-10'
    );
  });

  it('throws a clear error when the compare pageUrl is not absolute', () => {
    expect(() =>
      buildProductCompareItemListSchema({
        pageName: 'Bad compare page',
        pageUrl: '/smartphones/compare/a-vs-b',
        currency: 'NGN',
        products: [],
      })
    ).toThrow('compare schema pageUrl must be an absolute URL');
  });
});

describe('buildPriceBandPageSchemas', () => {
  it('builds breadcrumb and ItemList schema objects for price-band pages', () => {
    const schemas = buildPriceBandPageSchemas({
      breadcrumbItems: [
        { name: 'Ogabassey', url: 'https://ogabassey.com' },
        { name: 'Smartphones', url: 'https://ogabassey.com/smartphones' },
      ],
      pageName: 'Best Smartphones Under ₦500,000',
      pageUrl: 'https://ogabassey.com/smartphones/best-under/under-500k',
      currency: 'NGN',
      products: [
        {
          id: 'product-c',
          slug: 'galaxy-a56',
          name: 'Galaxy A56',
          category: 'Smartphones',
          category_slug: 'smartphones',
          price: 480_000,
          image: 'https://cdn.example.com/a56.jpg',
          availability: 'OutOfStock',
          description: '<p>Best <strong>midrange</strong> pick</p>',
        },
      ],
    });

    expect(schemas.breadcrumb['@type']).toBe('BreadcrumbList');
    expect(schemas.itemList['@type']).toBe('ItemList');
    expect(
      (
        schemas.itemList.itemListElement as Array<{
          item: { offers: { availability: string }; description: string };
        }>
      )[0]?.item.offers.availability
    ).toBe('https://schema.org/OutOfStock');
    expect(
      (
        schemas.itemList.itemListElement as Array<{
          item: { offers: { availability: string }; description: string };
        }>
      )[0]?.item.description
    ).toBe('Best midrange pick');
  });

  it('caps products at 20 items and truncates descriptions to at most 120 plain-text characters', () => {
    const longHtmlDescription = `<p>This is a very detailed description that goes on and on and contains all sorts of HTML markup like <strong>strong text</strong>, <em>italics</em>, and extra filler text to easily exceed the one hundred and twenty character limit enforced by the price band schema builder.</p>`;
    const products = Array.from({ length: 25 }, (_, i) => ({
      id: `product-${i + 1}`,
      slug: `phone-${i + 1}`,
      name: `Phone ${i + 1}`,
      category: 'Smartphones',
      category_slug: 'smartphones',
      price: 100_000 + i * 10_000,
      description: longHtmlDescription,
    }));

    const schemas = buildPriceBandPageSchemas({
      breadcrumbItems: [],
      pageName: 'Best Phones Under 500k',
      pageUrl: 'https://ogabassey.com/smartphones/best-under/under-500k',
      currency: 'NGN',
      products,
    });

    const items = schemas.itemList.itemListElement as Array<{
      item: { name: string; description: string };
    }>;

    expect(items).toHaveLength(20);
    for (const item of items) {
      expect(item.item.description.length).toBeLessThanOrEqual(120);
      expect(item.item.description).not.toContain('<');
      expect(item.item.description).not.toContain('>');
    }
  });

  it('throws a clear error when the price-band pageUrl is not absolute', () => {
    expect(() =>
      buildPriceBandPageSchemas({
        breadcrumbItems: [],
        pageName: 'Bad price band',
        pageUrl: '/smartphones/best-under/under-500k',
        currency: 'NGN',
        products: [],
      })
    ).toThrow('compare schema pageUrl must be an absolute URL');
  });
});
