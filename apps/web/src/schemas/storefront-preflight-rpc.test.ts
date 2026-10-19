import { describe, expect, it } from 'vitest';
import {
  STOREFRONT_AUTH_MERCHANT_RPC,
  STOREFRONT_BLOG_LISTING_STATUS_RPC,
  STOREFRONT_BLOG_POST_STATUS_RPC,
  STOREFRONT_PDP_PREFLIGHT_RPC,
  storefrontAuthMerchantRowSchema,
  storefrontBlogListingStatusRowSchema,
  storefrontBlogPostStatusRowSchema,
  storefrontPdpPreflightRowSchema,
} from '@/schemas/storefront-preflight-rpc';

const validPdpRow = {
  storefront_status: 'published',
  catalog_nonempty: true,
  present: true,
  match_kind: 'exact',
  product_id: 'product-1',
  product_name: 'iPhone 15 Pro',
  product_slug: 'iphone-15-pro',
  product_category: 'smartphones',
  category_id: 'category-1',
  category_name: 'Smartphones',
  category_slug: 'smartphones',
};

const validBlogRow = {
  storefront_status: 'published',
  blog_enabled: true,
  live_present: true,
  redirect_target_slug: 'new-post-slug',
};

const validBlogListingRow = {
  storefront_status: 'published',
  blog_enabled: true,
  total_count: 515,
  categories: ['Smartphones', 'Laptops'],
  category_counts: [228, 80],
  author_count: 287,
};

describe('storefrontPdpPreflightRowSchema', () => {
  it('parses a valid row', () => {
    const result = storefrontPdpPreflightRowSchema.safeParse(validPdpRow);

    expect(result.success).toBe(true);
  });

  it('accepts null for every nullable field', () => {
    const result = storefrontPdpPreflightRowSchema.safeParse({
      ...validPdpRow,
      product_id: null,
      product_name: null,
      product_slug: null,
      product_category: null,
      category_id: null,
      category_name: null,
      category_slug: null,
    });

    expect(result.success).toBe(true);
  });

  it('parses an unknown, future storefront_status value (tolerant contract)', () => {
    const result = storefrontPdpPreflightRowSchema.safeParse({
      ...validPdpRow,
      storefront_status: 'suspended',
    });

    expect(result.success).toBe(true);
  });

  it('strips unknown extra keys instead of rejecting the row', () => {
    const result = storefrontPdpPreflightRowSchema.safeParse({
      ...validPdpRow,
      extra_future_column: 'unexpected',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty('extra_future_column');
    }
  });

  it('rejects a row with boolean fields sent as strings', () => {
    const result = storefrontPdpPreflightRowSchema.safeParse({
      ...validPdpRow,
      catalog_nonempty: 'true',
      present: 'true',
    });

    expect(result.success).toBe(false);
  });

  it('rejects a row missing a required non-nullable field', () => {
    const { match_kind, ...withoutMatchKind } = validPdpRow;

    const result = storefrontPdpPreflightRowSchema.safeParse(withoutMatchKind);

    expect(result.success).toBe(false);
  });

  it('rejects null for a non-nullable field', () => {
    const result = storefrontPdpPreflightRowSchema.safeParse({
      ...validPdpRow,
      present: null,
    });

    expect(result.success).toBe(false);
  });
});

describe('storefrontAuthMerchantRowSchema', () => {
  it('accepts the minimal publication projection', () => {
    expect(
      storefrontAuthMerchantRowSchema.safeParse({ is_published: true }).success
    ).toBe(true);
  });

  it('rejects a non-boolean publication flag', () => {
    expect(
      storefrontAuthMerchantRowSchema.safeParse({ is_published: 'true' })
        .success
    ).toBe(false);
  });
});

describe('storefrontBlogPostStatusRowSchema', () => {
  it('parses a valid row', () => {
    const result = storefrontBlogPostStatusRowSchema.safeParse(validBlogRow);

    expect(result.success).toBe(true);
  });

  it('accepts null for the nullable redirect_target_slug field', () => {
    const result = storefrontBlogPostStatusRowSchema.safeParse({
      ...validBlogRow,
      redirect_target_slug: null,
    });

    expect(result.success).toBe(true);
  });

  it('parses an unknown, future storefront_status value (tolerant contract)', () => {
    const result = storefrontBlogPostStatusRowSchema.safeParse({
      ...validBlogRow,
      storefront_status: 'suspended',
    });

    expect(result.success).toBe(true);
  });

  it('strips unknown extra keys instead of rejecting the row', () => {
    const result = storefrontBlogPostStatusRowSchema.safeParse({
      ...validBlogRow,
      extra_future_column: 'unexpected',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty('extra_future_column');
    }
  });

  it('rejects a row with boolean fields sent as strings', () => {
    const result = storefrontBlogPostStatusRowSchema.safeParse({
      ...validBlogRow,
      blog_enabled: 'true',
      live_present: 'true',
    });

    expect(result.success).toBe(false);
  });

  it('rejects null for a non-nullable field', () => {
    const result = storefrontBlogPostStatusRowSchema.safeParse({
      ...validBlogRow,
      blog_enabled: null,
    });

    expect(result.success).toBe(false);
  });
});

describe('storefrontBlogListingStatusRowSchema', () => {
  it('parses a valid row', () => {
    const result =
      storefrontBlogListingStatusRowSchema.safeParse(validBlogListingRow);

    expect(result.success).toBe(true);
  });

  it('parses empty category arrays and a zero author count', () => {
    const result = storefrontBlogListingStatusRowSchema.safeParse({
      ...validBlogListingRow,
      total_count: 0,
      categories: [],
      category_counts: [],
      author_count: 0,
    });

    expect(result.success).toBe(true);
  });

  it('parses an unknown, future storefront_status value (tolerant contract)', () => {
    const result = storefrontBlogListingStatusRowSchema.safeParse({
      ...validBlogListingRow,
      storefront_status: 'suspended',
    });

    expect(result.success).toBe(true);
  });

  it('strips unknown extra keys instead of rejecting the row', () => {
    const result = storefrontBlogListingStatusRowSchema.safeParse({
      ...validBlogListingRow,
      extra_future_column: 'unexpected',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty('extra_future_column');
    }
  });

  it('rejects a count field sent as a string', () => {
    const result = storefrontBlogListingStatusRowSchema.safeParse({
      ...validBlogListingRow,
      total_count: '515',
    });

    expect(result.success).toBe(false);
  });

  it('rejects categories sent as a non-array', () => {
    const result = storefrontBlogListingStatusRowSchema.safeParse({
      ...validBlogListingRow,
      categories: 'Smartphones',
    });

    expect(result.success).toBe(false);
  });

  it('rejects null for the non-nullable blog_enabled field', () => {
    const result = storefrontBlogListingStatusRowSchema.safeParse({
      ...validBlogListingRow,
      blog_enabled: null,
    });

    expect(result.success).toBe(false);
  });
});

describe('RPC name constants', () => {
  it('match the migration function names exactly', () => {
    expect(STOREFRONT_PDP_PREFLIGHT_RPC).toBe('get_storefront_pdp_preflight');
    expect(STOREFRONT_BLOG_POST_STATUS_RPC).toBe(
      'get_storefront_blog_post_status'
    );
    expect(STOREFRONT_BLOG_LISTING_STATUS_RPC).toBe(
      'get_storefront_blog_listing_status'
    );
    expect(STOREFRONT_AUTH_MERCHANT_RPC).toBe(
      'resolve_storefront_auth_merchant'
    );
  });
});
