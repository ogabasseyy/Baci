import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StorefrontDatabase } from '@/types/storefront-database';
import { readStorefrontPdpSemanticEnrichment } from './storefront-pdp-semantic-enrichment';
import { storefrontPdpSemanticReadCooldown } from './storefront-pdp-semantic-read-cooldown-singleton';

const clusterRequest = {
  p_category_slug: 'smartphones',
  p_cluster_rules: [
    {
      rule_order: 0,
      category_slug: 'smartphones',
      category_names: ['smartphones', 'phones'],
      article_tokens: ['phone', 'battery'],
    },
  ],
  p_cluster_rules_json: '[{"rule_order":0}]',
  p_search_query: '"smartphones" OR "samsung"',
};

function createClient(response: unknown) {
  const abortSignal = vi.fn().mockResolvedValue(response);
  const rpc = vi.fn(() => ({ abortSignal }));
  return {
    abortSignal,
    client: { rpc } as unknown as SupabaseClient<StorefrontDatabase>,
    rpc,
  };
}

describe('readStorefrontPdpSemanticEnrichment', () => {
  beforeEach(() => {
    storefrontPdpSemanticReadCooldown.reset();
  });

  it('loads inventory and guides through one bounded RPC and prioritizes linked guides', async () => {
    const duplicateGuide = {
      slug: 's25-guide',
      title: 'Samsung Galaxy S25 guide',
      excerpt: 'Everything to know.',
      category: 'Smartphones',
      tags: ['phones'],
      keywords: ['samsung'],
      featured_image_url: null,
      published_at: '2026-06-20T12:00:00Z',
      reading_time_minutes: 6,
    };
    const { abortSignal, client, rpc } = createClient({
      data: [
        {
          resolution_status: 'found',
          inventory_data: [
            {
              slug: 'samsung-galaxy-s25',
              name: 'Samsung Galaxy S25',
              price: 900000,
              stock_quantity: 4,
              categories: { slug: 'smartphones' },
              product_key_specs: { ram_gb: 12, storage_gb: 256 },
            },
            {
              slug: 'samsung-galaxy-a56',
              name: 'Samsung Galaxy A56',
              price: 500000,
              stock_quantity: 2,
              categories: { slug: 'android-phones' },
              product_key_specs: null,
            },
          ],
          cluster_guide_data: [
            duplicateGuide,
            {
              ...duplicateGuide,
              slug: 'best-smartphones',
              title: 'Best smartphones',
            },
          ],
          product_guide_data: [duplicateGuide],
        },
      ],
      error: null,
      status: 200,
    });

    const result = await readStorefrontPdpSemanticEnrichment(client, {
      merchantId: 'merchant-1',
      productId: 'product-1',
      includeGuides: true,
      clusterRequest,
    });

    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith(
      'get_storefront_pdp_semantic_enrichment_v1',
      {
        p_category_slug: 'smartphones',
        p_cluster_guide_limit: 48,
        p_cluster_rules: clusterRequest.p_cluster_rules,
        p_include_guides: true,
        p_inventory_limit: 48,
        p_merchant_id: 'merchant-1',
        p_product_guide_limit: 8,
        p_product_id: 'product-1',
        p_search_query: clusterRequest.p_search_query,
      }
    );
    expect(abortSignal).toHaveBeenCalledWith(expect.any(AbortSignal));
    expect(result).toEqual({
      status: 'found',
      value: {
        inventory: [
          expect.objectContaining({
            slug: 'samsung-galaxy-s25',
            stock: 4,
            category_slug: 'smartphones',
          }),
          expect.objectContaining({
            slug: 'samsung-galaxy-a56',
            category_slug: 'android-phones',
          }),
        ],
        guidePosts: [
          expect.objectContaining({ slug: 's25-guide' }),
          expect.objectContaining({ slug: 'best-smartphones' }),
        ],
        priorityGuidePostSlugs: ['s25-guide'],
      },
    });
  });

  it('keeps a valid empty enrichment distinct from product absence', async () => {
    const { client } = createClient({
      data: [
        {
          resolution_status: 'found',
          inventory_data: [],
          cluster_guide_data: [],
          product_guide_data: [],
        },
      ],
      error: null,
      status: 200,
    });

    await expect(
      readStorefrontPdpSemanticEnrichment(client, {
        merchantId: 'merchant-1',
        productId: 'product-1',
        includeGuides: false,
        clusterRequest,
      })
    ).resolves.toEqual({
      status: 'found',
      value: {
        inventory: [],
        guidePosts: [],
        priorityGuidePostSlugs: [],
      },
    });

    const missing = createClient({
      data: [
        {
          resolution_status: 'not_found',
          inventory_data: null,
          cluster_guide_data: null,
          product_guide_data: null,
        },
      ],
      error: null,
      status: 200,
    });

    await expect(
      readStorefrontPdpSemanticEnrichment(missing.client, {
        merchantId: 'merchant-1',
        productId: 'missing-product',
        includeGuides: true,
        clusterRequest,
      })
    ).resolves.toEqual({ status: 'not_found' });
  });

  it('classifies transport failures without fabricating an empty enrichment', async () => {
    const { client } = createClient({
      data: null,
      error: { code: '57014', message: 'statement timeout' },
      status: 500,
    });

    await expect(
      readStorefrontPdpSemanticEnrichment(client, {
        merchantId: 'merchant-1',
        productId: 'product-1',
        includeGuides: true,
        clusterRequest,
      })
    ).resolves.toEqual({
      status: 'unavailable',
      error: expect.objectContaining({
        kind: 'timeout',
        operation: 'pdp_semantic_enrichment',
        retryable: true,
      }),
    });
  });

  it('rejects empty or malformed found rows as contract unavailability', async () => {
    const empty = createClient({ data: [], error: null, status: 200 });
    await expect(
      readStorefrontPdpSemanticEnrichment(empty.client, {
        merchantId: 'merchant-1',
        productId: 'product-1',
        includeGuides: true,
        clusterRequest,
      })
    ).resolves.toEqual({
      status: 'unavailable',
      error: expect.objectContaining({ kind: 'integrity' }),
    });

    const malformed = createClient({
      data: [
        {
          resolution_status: 'found',
          inventory_data: null,
          cluster_guide_data: [],
          product_guide_data: [],
        },
      ],
      error: null,
      status: 200,
    });
    await expect(
      readStorefrontPdpSemanticEnrichment(malformed.client, {
        merchantId: 'merchant-1',
        productId: 'product-1',
        includeGuides: true,
        clusterRequest,
      })
    ).resolves.toEqual({
      status: 'unavailable',
      error: expect.objectContaining({ kind: 'integrity' }),
    });
  });

  describe('manage_stock validation and candidate stock resolution', () => {
    it('resolves manage_stock: false with zero stock as stock: null (unmanaged)', async () => {
      const { client } = createClient({
        data: [
          {
            resolution_status: 'found',
            inventory_data: [
              {
                slug: 'unmanaged-phone',
                name: 'Unmanaged Phone',
                price: 150000,
                stock: 0,
                stock_quantity: 0,
                manage_stock: false,
                categories: { slug: 'smartphones' },
              },
            ],
            cluster_guide_data: [],
            product_guide_data: [],
          },
        ],
        error: null,
        status: 200,
      });

      const result = await readStorefrontPdpSemanticEnrichment(client, {
        merchantId: 'merchant-1',
        productId: 'product-1',
        includeGuides: false,
        clusterRequest,
      });

      expect(result).toEqual({
        status: 'found',
        value: {
          inventory: [
            expect.objectContaining({
              slug: 'unmanaged-phone',
              stock: null,
              manage_stock: false,
            }),
          ],
          guidePosts: [],
          priorityGuidePostSlugs: [],
        },
      });
    });

    it('resolves manage_stock: null with zero stock as stock: null (unmanaged)', async () => {
      const { client } = createClient({
        data: [
          {
            resolution_status: 'found',
            inventory_data: [
              {
                slug: 'null-manage-stock-phone',
                name: 'Null Manage Stock Phone',
                price: 150000,
                stock: 0,
                stock_quantity: 0,
                manage_stock: null,
                categories: { slug: 'smartphones' },
              },
            ],
            cluster_guide_data: [],
            product_guide_data: [],
          },
        ],
        error: null,
        status: 200,
      });

      const result = await readStorefrontPdpSemanticEnrichment(client, {
        merchantId: 'merchant-1',
        productId: 'product-1',
        includeGuides: false,
        clusterRequest,
      });

      expect(result).toEqual({
        status: 'found',
        value: {
          inventory: [
            expect.objectContaining({
              slug: 'null-manage-stock-phone',
              stock: null,
              manage_stock: null,
            }),
          ],
          guidePosts: [],
          priorityGuidePostSlugs: [],
        },
      });
    });

    it('resolves manage_stock: true with zero stock as stock: 0 (tracked sold-out)', async () => {
      const { client } = createClient({
        data: [
          {
            resolution_status: 'found',
            inventory_data: [
              {
                slug: 'sold-out-phone',
                name: 'Sold Out Phone',
                price: 150000,
                stock: 0,
                stock_quantity: 0,
                manage_stock: true,
                categories: { slug: 'smartphones' },
              },
            ],
            cluster_guide_data: [],
            product_guide_data: [],
          },
        ],
        error: null,
        status: 200,
      });

      const result = await readStorefrontPdpSemanticEnrichment(client, {
        merchantId: 'merchant-1',
        productId: 'product-1',
        includeGuides: false,
        clusterRequest,
      });

      expect(result).toEqual({
        status: 'found',
        value: {
          inventory: [
            expect.objectContaining({
              slug: 'sold-out-phone',
              stock: 0,
              manage_stock: true,
            }),
          ],
          guidePosts: [],
          priorityGuidePostSlugs: [],
        },
      });
    });

    it('falls back to finite stock: 0 when manage_stock is omitted (legacy payload fallback)', async () => {
      const { client } = createClient({
        data: [
          {
            resolution_status: 'found',
            inventory_data: [
              {
                slug: 'legacy-phone',
                name: 'Legacy Phone',
                price: 150000,
                stock: 0,
                stock_quantity: 0,
                categories: { slug: 'smartphones' },
              },
            ],
            cluster_guide_data: [],
            product_guide_data: [],
          },
        ],
        error: null,
        status: 200,
      });

      const result = await readStorefrontPdpSemanticEnrichment(client, {
        merchantId: 'merchant-1',
        productId: 'product-1',
        includeGuides: false,
        clusterRequest,
      });

      expect(result).toEqual({
        status: 'found',
        value: {
          inventory: [
            expect.objectContaining({
              slug: 'legacy-phone',
              stock: 0,
              manage_stock: null,
            }),
          ],
          guidePosts: [],
          priorityGuidePostSlugs: [],
        },
      });
    });

    it.each([
      ['string "false"', 'false'],
      ['string "true"', 'true'],
      ['numeric 1', 1],
      ['numeric 0', 0],
      ['object', {}],
      ['array', []],
    ])('rejects malformed present manage_stock value (%s) as integrity failure', async (_label, malformedValue) => {
      const { client } = createClient({
        data: [
          {
            resolution_status: 'found',
            inventory_data: [
              {
                slug: 'malformed-phone',
                name: 'Malformed Phone',
                price: 150000,
                stock: 0,
                stock_quantity: 0,
                manage_stock: malformedValue,
                categories: { slug: 'smartphones' },
              },
            ],
            cluster_guide_data: [],
            product_guide_data: [],
          },
        ],
        error: null,
        status: 200,
      });

      await expect(
        readStorefrontPdpSemanticEnrichment(client, {
          merchantId: 'merchant-1',
          productId: 'product-1',
          includeGuides: false,
          clusterRequest,
        })
      ).resolves.toEqual({
        status: 'unavailable',
        error: expect.objectContaining({
          kind: 'integrity',
          operation: 'pdp_semantic_enrichment',
        }),
      });
    });
  });
});
