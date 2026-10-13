import { describe, expect, it } from 'vitest';
import {
  internalBlogListingStatusQuerySchema,
  internalBlogPostStatusQuerySchema,
  internalComparePageStatusBodySchema,
  internalComparePageStatusQuerySchema,
  internalProductCanonicalRedirectQuerySchema,
  internalSlugSetParamsSchema,
  internalSlugSetQuerySchema,
} from '@/schemas/internal-slug-set-route';

describe('internalSlugSetParamsSchema', () => {
  it('accepts a non-empty identifier and trims it', () => {
    const result = internalSlugSetParamsSchema.safeParse({
      identifier: '  ogabassey.com  ',
    });
    expect(result.success).toBe(true);
    expect(result.data?.identifier).toBe('ogabassey.com');
  });

  it('rejects a missing identifier', () => {
    expect(internalSlugSetParamsSchema.safeParse({}).success).toBe(false);
  });

  it('rejects a blank identifier', () => {
    expect(
      internalSlugSetParamsSchema.safeParse({ identifier: '   ' }).success
    ).toBe(false);
  });

  it('rejects an over-long identifier (>255)', () => {
    expect(
      internalSlugSetParamsSchema.safeParse({ identifier: 'a'.repeat(256) })
        .success
    ).toBe(false);
  });
});

describe('internalSlugSetQuerySchema', () => {
  it('accepts a non-empty slug and trims it', () => {
    const result = internalSlugSetQuerySchema.safeParse({
      slug: ' iphone-15 ',
    });
    expect(result.success).toBe(true);
    expect(result.data?.slug).toBe('iphone-15');
  });

  it('rejects a null/missing slug', () => {
    expect(internalSlugSetQuerySchema.safeParse({ slug: null }).success).toBe(
      false
    );
    expect(internalSlugSetQuerySchema.safeParse({}).success).toBe(false);
  });

  it('rejects a blank slug', () => {
    expect(internalSlugSetQuerySchema.safeParse({ slug: '  ' }).success).toBe(
      false
    );
  });
});

describe('internalBlogPostStatusQuerySchema', () => {
  it('accepts and trims a blog post slug', () => {
    const result = internalBlogPostStatusQuerySchema.safeParse({
      slug: ' retired-post ',
    });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ slug: 'retired-post' });
  });

  it('rejects missing or blank blog post slugs', () => {
    expect(internalBlogPostStatusQuerySchema.safeParse({}).success).toBe(false);
    expect(
      internalBlogPostStatusQuerySchema.safeParse({ slug: '   ' }).success
    ).toBe(false);
  });

  it('rejects over-long blog post slugs', () => {
    expect(
      internalBlogPostStatusQuerySchema.safeParse({ slug: 'a'.repeat(256) })
        .success
    ).toBe(false);
  });
});

describe('internalProductCanonicalRedirectQuerySchema', () => {
  it('accepts and trims category and product slug values', () => {
    const result = internalProductCanonicalRedirectQuerySchema.safeParse({
      category: ' smartphones ',
      slug: ' iphone-15-pro ',
    });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      category: 'smartphones',
      slug: 'iphone-15-pro',
    });
  });

  it('rejects missing or blank values', () => {
    expect(
      internalProductCanonicalRedirectQuerySchema.safeParse({
        category: '',
        slug: 'iphone-15-pro',
      }).success
    ).toBe(false);
    expect(
      internalProductCanonicalRedirectQuerySchema.safeParse({
        category: 'smartphones',
        slug: '   ',
      }).success
    ).toBe(false);
    expect(
      internalProductCanonicalRedirectQuerySchema.safeParse({}).success
    ).toBe(false);
  });
});

describe('internalBlogListingStatusQuerySchema', () => {
  it('parses each intent kind and coerces page', () => {
    expect(
      internalBlogListingStatusQuerySchema.safeParse({
        kind: 'category-query',
        category: 'Smartphones',
      }).data
    ).toEqual({ kind: 'category-query', category: 'Smartphones' });

    expect(
      internalBlogListingStatusQuerySchema.safeParse({
        kind: 'listing-page',
        page: '99',
      }).data
    ).toEqual({ kind: 'listing-page', page: 99 });

    expect(
      internalBlogListingStatusQuerySchema.safeParse({
        kind: 'author',
        authorSlug: 'bassey-john',
      }).data
    ).toEqual({ kind: 'author', authorSlug: 'bassey-john', page: 1 });
  });

  it('rejects unknown kinds and missing required fields', () => {
    expect(
      internalBlogListingStatusQuerySchema.safeParse({ kind: 'bogus' }).success
    ).toBe(false);
    expect(
      internalBlogListingStatusQuerySchema.safeParse({ kind: 'category-query' })
        .success
    ).toBe(false);
    expect(
      internalBlogListingStatusQuerySchema.safeParse({
        kind: 'category-page',
        categorySlug: 'smartphones',
        page: '0',
      }).success
    ).toBe(false);
    // author requires authorSlug (page has a default).
    expect(
      internalBlogListingStatusQuerySchema.safeParse({ kind: 'author' }).success
    ).toBe(false);
  });

  it('rejects page values above the route cap (10_000)', () => {
    expect(
      internalBlogListingStatusQuerySchema.safeParse({
        kind: 'listing-page',
        page: '10000',
      }).success
    ).toBe(true);
    expect(
      internalBlogListingStatusQuerySchema.safeParse({
        kind: 'listing-page',
        page: '10001',
      }).success
    ).toBe(false);
  });
});

describe('internalComparePageStatusQuerySchema', () => {
  it('accepts a bounded composite comparison slug', () => {
    const result = internalComparePageStatusQuerySchema.safeParse({
      category: ' laptops ',
      comparison: ' left-laptop-vs-right-laptop ',
    });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      category: 'laptops',
      comparison: 'left-laptop-vs-right-laptop',
    });
  });

  it('enforces the category boundaries', () => {
    expect(
      internalComparePageStatusQuerySchema.safeParse({
        category: '   ',
        comparison: 'left-vs-right',
      }).success
    ).toBe(false);
    expect(
      internalComparePageStatusQuerySchema.safeParse({
        category: 'a'.repeat(255),
        comparison: 'left-vs-right',
      }).success
    ).toBe(true);
    expect(
      internalComparePageStatusQuerySchema.safeParse({
        category: 'a'.repeat(256),
        comparison: 'left-vs-right',
      }).success
    ).toBe(false);
  });

  it('rejects an over-long comparison slug', () => {
    expect(
      internalComparePageStatusQuerySchema.safeParse({
        category: 'laptops',
        comparison: 'a'.repeat(1025),
      }).success
    ).toBe(false);
  });

  it('accepts the maximum-length comparison slug and rejects blank input', () => {
    expect(
      internalComparePageStatusQuerySchema.safeParse({
        category: 'laptops',
        comparison: 'a'.repeat(1024),
      }).success
    ).toBe(true);
    expect(
      internalComparePageStatusQuerySchema.safeParse({
        category: 'laptops',
        comparison: '   ',
      }).success
    ).toBe(false);
  });
});

describe('internalComparePageStatusBodySchema', () => {
  it('requires the explicit fail-open bit', () => {
    expect(
      internalComparePageStatusBodySchema.safeParse({
        present: false,
        hasError: true,
      }).success
    ).toBe(true);
    expect(
      internalComparePageStatusBodySchema.safeParse({ present: false }).success
    ).toBe(false);
  });

  it('requires present to be a boolean', () => {
    expect(
      internalComparePageStatusBodySchema.safeParse({
        present: 'false',
        hasError: false,
      }).success
    ).toBe(false);
    expect(
      internalComparePageStatusBodySchema.safeParse({
        present: false,
        hasError: true,
      }).data
    ).toEqual({ present: false, hasError: true });
  });
});
