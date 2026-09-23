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
});
