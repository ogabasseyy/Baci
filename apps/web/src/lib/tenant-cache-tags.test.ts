import { describe, expect, it } from 'vitest';
import {
  buildResolvedMerchantScopeTags,
  buildStorefrontMerchantLookupTags,
  getBlogCategoriesMerchantCacheTag,
  getBlogCategoryHubCacheTag,
  getBlogIdentifierCacheTag,
  getBlogListingStatusCacheTag,
  getBlogPostsMerchantCacheTag,
  getBlogRssMerchantCacheTag,
  getPageConfigMerchantCacheTag,
  getPageConfigSlugCacheTag,
} from './tenant-cache-tags';

describe('tenant-cache-tags', () => {
  it('builds slug and domain lookup tags for slug identifiers', () => {
    expect(buildStorefrontMerchantLookupTags(' Ogabassey ')).toEqual([
      'merchant-ogabassey',
      'merchant-slug-ogabassey',
      'domain-ogabassey',
    ]);
  });

  it('omits merchant-slug tag for domain identifiers', () => {
    expect(buildStorefrontMerchantLookupTags('Shop.Example.COM')).toEqual([
      'merchant-shop.example.com',
      'domain-shop.example.com',
    ]);
  });

  it('returns empty lookup tags for blank identifiers', () => {
    expect(buildStorefrontMerchantLookupTags('   ')).toEqual([]);
  });

  it('builds full tenant-scoped tags for a resolved merchant with custom domain', () => {
    expect(
      buildResolvedMerchantScopeTags({
        id: 'merchant-1',
        slug: 'Ogabassey',
        custom_domain: 'Ogabassey.COM',
      })
    ).toEqual([
      'merchant-id-merchant-1',
      'features-merchant-1',
      'merchant-ogabassey',
      'merchant-slug-ogabassey',
      'domain-ogabassey.com',
      'merchant-ogabassey.com',
    ]);
  });

  it('formats scoped blog and page-config cache tags consistently', () => {
    expect(getBlogPostsMerchantCacheTag('m-1')).toBe('blog-posts-m-1');
    expect(getBlogCategoriesMerchantCacheTag('m-1')).toBe(
      'blog-categories-m-1'
    );
    expect(getBlogIdentifierCacheTag('Shop.Example.COM')).toBe(
      'blog-identifier-shop.example.com'
    );
    expect(getBlogRssMerchantCacheTag('Ogabassey')).toBe('blog-rss-ogabassey');
    expect(getBlogListingStatusCacheTag('Ogabassey')).toBe(
      'blog-listing-status-ogabassey'
    );
    expect(getBlogCategoryHubCacheTag('Ogabassey')).toBe(
      'blog-category-hub-ogabassey'
    );
    expect(getPageConfigMerchantCacheTag('m-1')).toBe('page-config-m-1');
    expect(getPageConfigSlugCacheTag('m-1', 'about-us')).toBe(
      'page-config-m-1-about-us'
    );
  });
});
