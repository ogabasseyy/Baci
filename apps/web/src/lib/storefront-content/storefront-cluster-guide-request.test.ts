import { describe, expect, it } from 'vitest';
import { buildStorefrontClusterGuideRequest } from './storefront-cluster-guide-request';

describe('buildStorefrontClusterGuideRequest', () => {
  it('builds a byte-bounded classifier request from the shared content map', () => {
    const request = buildStorefrontClusterGuideRequest({
      pageKind: 'product',
      categorySlug: 'smartphones',
      brands: ['Samsung'],
      productSlugs: ['samsung-galaxy-s25'],
    });

    expect(request.p_category_slug).toBe('smartphones');
    expect(request.p_cluster_rules).toHaveLength(26);
    expect(request.p_cluster_rules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category_slug: 'smartphones',
          category_names: expect.arrayContaining(['smartphones', 'phones']),
          article_tokens: expect.arrayContaining(['phone', 'battery']),
        }),
      ])
    );
    expect(request.p_search_query).toContain('"smartphones"');
    expect(request.p_search_query).toContain('"samsung"');
    expect(
      Buffer.byteLength(JSON.stringify(request.p_cluster_rules), 'utf8')
    ).toBeLessThanOrEqual(8192);
  });

  it('fails closed for categories outside the supported semantic map', () => {
    expect(
      buildStorefrontClusterGuideRequest({
        pageKind: 'product',
        categorySlug: 'uncategorized',
      })
    ).toEqual({
      p_category_slug: 'uncategorized',
      p_cluster_rules: [],
      p_search_query: '',
    });
  });

  it('clears explicit category_names on gaming and laptops when requesting gaming-laptops so SQL pre-filtering allows cross-category promotion', () => {
    const request = buildStorefrontClusterGuideRequest({
      pageKind: 'product',
      categorySlug: 'gaming-laptops',
      brands: ['ASUS'],
    });
    const gamingRule = request.p_cluster_rules.find(
      (r) => r.category_slug === 'gaming'
    );
    const laptopsRule = request.p_cluster_rules.find(
      (r) => r.category_slug === 'laptops'
    );
    expect(gamingRule?.category_names).toEqual([]);
    expect(laptopsRule?.category_names).toEqual([]);
  });
});
