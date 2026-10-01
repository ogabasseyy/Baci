import { describe, expect, it } from 'vitest';
import { buildClusterGuideSearchQuery } from './build-cluster-guide-search-query';

describe('buildClusterGuideSearchQuery', () => {
  it('prioritizes category and page-specific commercial context', () => {
    const query = buildClusterGuideSearchQuery({
      pageKind: 'price-band',
      categorySlug: 'smartphones',
      brands: ['Apple'],
      priceBandSlug: 'under-300k',
      productSlugs: ['iphone-15-pro-max'],
    });

    expect(query).toContain('"smartphones"');
    expect(query).toContain('"apple"');
    expect(query).toContain('"iphone 15 pro max"');
    expect(query).toContain('"budget"');
    expect(query).toContain(' OR ');
  });

  it('quotes normalized terms so untrusted context cannot inject search operators', () => {
    const query = buildClusterGuideSearchQuery({
      pageKind: 'product',
      categorySlug: 'smartphones',
      brands: ['" OR password:*'],
      productSlugs: ['pixel-8)\nOR-(secret'],
    });

    expect(query).not.toContain('password:*');
    expect(query).not.toContain(')');
    expect(query).not.toContain('\n');
    expect(query.split(' OR ')).toEqual(
      expect.arrayContaining(['"password"', '"8 secret"'])
    );
    expect(query.split(' OR ').every((term) => /^"[^"\\]+"$/u.test(term))).toBe(
      true
    );
  });

  it('deduplicates terms and never truncates a quoted expression', () => {
    const query = buildClusterGuideSearchQuery({
      pageKind: 'compare',
      categorySlug: 'smartphones',
      brands: Array.from({ length: 80 }, (_, index) => `Móbílè ${index}`),
      productSlugs: Array.from(
        { length: 80 },
        (_, index) => `phone-model-${index}`
      ),
    });
    const terms = query.split(' OR ');

    expect(query.length).toBeLessThanOrEqual(512);
    expect(new TextEncoder().encode(query).byteLength).toBeLessThanOrEqual(512);
    expect(new Set(terms).size).toBe(terms.length);
    expect(terms.every((term) => /^"[^"\\]+"$/u.test(term))).toBe(true);
    expect(query.endsWith('"')).toBe(true);
  });

  it('spreads compact category product markers across the bounded query', () => {
    const productSlugs = Array.from(
      { length: 40 },
      (_, index) => `itel-model-${String(index + 1).padStart(2, '0')}`
    );
    const query = buildClusterGuideSearchQuery({
      pageKind: 'category',
      categorySlug: 'smartphones',
      brands: ['Itel'],
      productSlugs,
    });

    expect(query).toContain('"01"');
    expect(query).toContain('"20"');
    expect(query).toContain('"40"');
    expect(query).not.toContain('"itel model 01"');
    expect(new TextEncoder().encode(query).byteLength).toBeLessThanOrEqual(512);
  });

  it('retains every compact marker from a full compound authority catalog', () => {
    const modelNumbers = Array.from({ length: 48 }, (_, index) => index + 101);
    const query = buildClusterGuideSearchQuery({
      pageKind: 'category',
      categorySlug: 'smartphones',
      brands: ['Apple'],
      productSlugs: modelNumbers.map(
        (modelNumber) => `apple-iphone-${modelNumber}-pro-max`
      ),
    });

    expect(
      modelNumbers.every((modelNumber) => query.includes(`"${modelNumber}"`))
    ).toBe(true);
    expect(new TextEncoder().encode(query).byteLength).toBeLessThanOrEqual(512);
  });

  it('uses normalized model terms for product and compare retrieval', () => {
    for (const pageKind of ['product', 'compare'] as const) {
      const query = buildClusterGuideSearchQuery({
        pageKind,
        categorySlug: 'smartphones',
        brands: ['Samsung'],
        productSlugs: ['samsung-galaxy-s25-ultra-12gb-256gb'],
      });

      expect(query).toContain('"s25 ultra"');
      expect(query).toContain('"samsung galaxy s25 ultra 12gb 256gb"');
    }
  });

  it('includes the model family phrase in category retrieval', () => {
    const query = buildClusterGuideSearchQuery({
      pageKind: 'category',
      categorySlug: 'smartphones',
      brands: ['Tecno'],
      modelFamilySlug: 'spark',
      productSlugs: ['tecno-spark-30', 'tecno-spark-40'],
    });

    expect(query).toContain('"spark"');
  });

  it('uses a later numeric laptop code instead of the display size', () => {
    const query = buildClusterGuideSearchQuery({
      pageKind: 'category',
      categorySlug: 'laptops',
      brands: ['Dell'],
      productSlugs: ['dell-inspiron-14-7430-2-in-1'],
    });

    expect(query).toContain('"7430"');
    expect(query).not.toContain('"14"');
  });

  it('retains a gift-card currency discriminator in retrieval terms', () => {
    const query = buildClusterGuideSearchQuery({
      pageKind: 'product',
      categorySlug: 'gift-cards',
      productNames: ['PSN Card £50 Gift Card'],
      productSlugs: [],
    });

    expect(query).toContain('"gbp 50"');
  });

  it('adds raw index-compatible fallbacks for currency and plus symbols', () => {
    const giftCardQuery = buildClusterGuideSearchQuery({
      pageKind: 'product',
      categorySlug: 'gift-cards',
      productNames: ['PSN Card £50 Gift Card'],
      productSlugs: [],
    });
    const plusModelQuery = buildClusterGuideSearchQuery({
      pageKind: 'product',
      categorySlug: 'smartphones',
      brands: ['Samsung'],
      productNames: ['Samsung Galaxy S24+'],
      productSlugs: [],
    });

    expect(giftCardQuery).toContain('"psn card 50 gift card"');
    expect(plusModelQuery).toContain('"samsung galaxy s24"');
  });

  it('preserves storage metadata in index-compatible product fallbacks', () => {
    const query = buildClusterGuideSearchQuery({
      pageKind: 'product',
      categorySlug: 'smartphones',
      brands: ['Samsung'],
      productNames: ['Samsung Galaxy S25 Ultra 12GB 256GB'],
      productSlugs: [],
    });

    expect(query).toContain('"samsung galaxy s25 ultra 12gb 256gb"');
  });
});
