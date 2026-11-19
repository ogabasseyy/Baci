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
  getBlogRssMerchantIdCacheTag,
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
    expect(getBlogRssMerchantCacheTag('Ogabassey')).toBe(
      'blog-rss-slug-ogabassey'
    );
    expect(getBlogRssMerchantIdCacheTag('M-1')).toBe('blog-rss-id-m-1');
    expect(getBlogPostsMerchantCacheTag('M-1')).toBe('blog-posts-m-1');
    expect(getBlogCategoriesMerchantCacheTag('M-1')).toBe(
      'blog-categories-m-1'
    );
    expect(getBlogListingStatusCacheTag('Ogabassey')).toBe(
      'blog-listing-status-ogabassey'
    );
    expect(getBlogCategoryHubCacheTag('Ogabassey')).toBe(
      'blog-category-hub-ogabassey'
    );
    expect(getPageConfigMerchantCacheTag('M-1')).toBe('page-config-m-1');
    expect(getPageConfigSlugCacheTag('m-1', 'about-us')).toBe(
      'page-config-m-1-about-us'
    );
  });

  it('bounds long custom-domain and slug cache tags to at most 256 bytes without collisions', () => {
    const longDomainA = `${'a'.repeat(240)}.example.com`;
    const longDomainB = `${'a'.repeat(239)}b.example.com`;
    const longSlug = 's'.repeat(250);

    const tagsA = [
      ...buildStorefrontMerchantLookupTags(longDomainA),
      ...buildResolvedMerchantScopeTags({
        id: 'merchant-1',
        slug: longSlug,
        custom_domain: longDomainA,
      }),
      getBlogIdentifierCacheTag(longDomainA),
      getBlogRssMerchantCacheTag(longDomainA),
      getBlogListingStatusCacheTag(longDomainA),
      getBlogCategoryHubCacheTag(longDomainA),
      getPageConfigSlugCacheTag('merchant-1', longSlug),
    ];

    for (const tag of tagsA) {
      expect(Buffer.byteLength(tag, 'utf8')).toBeLessThanOrEqual(256);
    }

    expect(getBlogIdentifierCacheTag(longDomainA)).not.toBe(
      getBlogIdentifierCacheTag(longDomainB)
    );
    expect(getBlogListingStatusCacheTag(longDomainA)).not.toBe(
      getBlogListingStatusCacheTag(longDomainB)
    );
    expect(getBlogCategoryHubCacheTag(longDomainA)).not.toBe(
      getBlogCategoryHubCacheTag(longDomainB)
    );
  });
});
