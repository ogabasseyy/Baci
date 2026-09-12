import { describe, expect, it } from 'vitest';
import {
  internalRevalidateProductEntrySchema,
  internalRevalidateProductsBodySchema,
} from '@/schemas/internal-revalidate-products-route';

describe('internalRevalidateProductsBodySchema', () => {
  it('accepts a non-empty merchantId and trims it', () => {
    const result = internalRevalidateProductsBodySchema.safeParse({
      merchantId: '  merchant-1  ',
    });
    expect(result.success).toBe(true);
    expect(result.data?.merchantId).toBe('merchant-1');
  });

  it('rejects a missing merchantId', () => {
    expect(internalRevalidateProductsBodySchema.safeParse({}).success).toBe(
      false
    );
  });

  it('rejects a blank merchantId', () => {
    expect(
      internalRevalidateProductsBodySchema.safeParse({ merchantId: '   ' })
        .success
    ).toBe(false);
  });

  it('rejects a non-string merchantId', () => {
    expect(
      internalRevalidateProductsBodySchema.safeParse({ merchantId: 123 })
        .success
    ).toBe(false);
  });

  it('accepts an optional merchantSlug and products array (backward compatible)', () => {
    const result = internalRevalidateProductsBodySchema.safeParse({
      merchantId: 'merchant-1',
      merchantSlug: 'ogabassey',
      products: [
        { slug: 'iphone-15', category: 'Smartphones' },
        { id: 'prod-2', categorySlug: 'tablets' },
      ],
    });
    expect(result.success).toBe(true);
    expect(result.data?.products).toHaveLength(2);
  });

  it('still accepts a merchantId-only body (no purge fields)', () => {
    const result = internalRevalidateProductsBodySchema.safeParse({
      merchantId: 'merchant-1',
    });
    expect(result.success).toBe(true);
    expect(result.data?.products).toBeUndefined();
    expect(result.data?.merchantSlug).toBeUndefined();
  });

  it('accepts the standalone-worker blog expiry flag', () => {
    const result = internalRevalidateProductsBodySchema.safeParse({
      merchantId: 'merchant-1',
      expireProductBlogCache: true,
    });
    expect(result.success).toBe(true);
    expect(result.data?.expireProductBlogCache).toBe(true);
  });

  it('accepts an explicit whole-storefront purge only with the trusted storefront identifier', () => {
    const result = internalRevalidateProductsBodySchema.safeParse({
      merchantId: 'merchant-1',
      merchantSlug: 'ogabassey',
      purgeWholeStorefront: true,
    });

    expect(result.success).toBe(true);
    expect(result.data?.purgeWholeStorefront).toBe(true);
  });

  it('rejects a whole-storefront purge without a storefront identifier', () => {
    const result = internalRevalidateProductsBodySchema.safeParse({
      merchantId: 'merchant-1',
      purgeWholeStorefront: true,
    });

    expect(result.success).toBe(false);
  });

  it('rejects a product entry with neither a slug nor an id', () => {
    const result = internalRevalidateProductsBodySchema.safeParse({
      merchantId: 'merchant-1',
      merchantSlug: 'ogabassey',
      products: [{ category: 'Smartphones' }],
    });
    expect(result.success).toBe(false);
  });
});

describe('internalRevalidateProductEntrySchema', () => {
  it('treats a blank slug as absent and falls back to the id', () => {
    const result = internalRevalidateProductEntrySchema.safeParse({
      slug: '   ',
      id: 'prod-123',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.slug).toBeNull();
      expect(result.data.id).toBe('prod-123');
    }
  });

  it('rejects a blank slug with a blank id', () => {
    const result = internalRevalidateProductEntrySchema.safeParse({
      slug: '',
      id: '  ',
    });
    expect(result.success).toBe(false);
  });

  it('accepts a null slug when an id is present (legacy null-slug rows)', () => {
    const result = internalRevalidateProductEntrySchema.safeParse({
      slug: null,
      id: 'prod-1',
      category: 'Smartphones',
    });
    expect(result.success).toBe(true);
    expect(result.data?.slug).toBeNull();
    expect(result.data?.id).toBe('prod-1');
  });

  it('accepts a null id when a slug is present', () => {
    const result = internalRevalidateProductEntrySchema.safeParse({
      slug: 'iphone-15',
      id: null,
    });
    expect(result.success).toBe(true);
    expect(result.data?.id).toBeNull();
    expect(result.data?.slug).toBe('iphone-15');
  });

  it('accepts null category and categorySlug hints', () => {
    const result = internalRevalidateProductEntrySchema.safeParse({
      slug: 'iphone-15',
      category: null,
      categorySlug: null,
    });
    expect(result.success).toBe(true);
  });

  it('rejects an entry with both a null slug and a null id', () => {
    const result = internalRevalidateProductEntrySchema.safeParse({
      slug: null,
      id: null,
    });
    expect(result.success).toBe(false);
  });

  it('accepts an optional previousCategoryId and trims it', () => {
    const result = internalRevalidateProductEntrySchema.safeParse({
      slug: 'iphone-15',
      id: 'prod-1',
      previousCategoryId: '  cat-old  ',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.previousCategoryId).toBe('cat-old');
    }
  });

  it('leaves previousCategoryId undefined when omitted (backward compatible)', () => {
    const result = internalRevalidateProductEntrySchema.safeParse({
      slug: 'iphone-15',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.previousCategoryId).toBeUndefined();
    }
  });

  it('treats a blank previousCategoryId as absent (null)', () => {
    const result = internalRevalidateProductEntrySchema.safeParse({
      slug: 'iphone-15',
      previousCategoryId: '   ',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.previousCategoryId).toBeNull();
    }
  });

  it('accepts an explicit null previousCategoryId', () => {
    const result = internalRevalidateProductEntrySchema.safeParse({
      slug: 'iphone-15',
      previousCategoryId: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.previousCategoryId).toBeNull();
    }
  });
});
