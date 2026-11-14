import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import type { StorefrontDatabase } from '@/types/storefront-database';
import { readStorefrontPdpSemanticEnrichment } from './storefront-pdp-semantic-enrichment';

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

function createClient({
  data,
  error,
  status,
}: {
  data: unknown;
  error: unknown;
  status: number;
}) {
  const rpc = vi.fn().mockReturnValue(
    Promise.resolve({
      data,
      error,
      status,
    })
  );

  return {
    client: {
      rpc,
    } as unknown as SupabaseClient<StorefrontDatabase>,
    rpc,
  };
}

describe('storefront-pdp-semantic-enrichment manage_stock resolution', () => {
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

  it('resolves manage_stock: null with zero stock as stock: 0 (managed default)', async () => {
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
            stock: 0,
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
            manage_stock: undefined,
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
