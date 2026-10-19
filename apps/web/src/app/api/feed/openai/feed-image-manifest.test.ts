import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { fetchVerifiedOpenAIImageManifest } from './feed-image-manifest';

type ManifestFixture = {
  product_id: string;
  variant_id?: string | null;
  source_url?: string | null;
  verified_url: string | null;
  verified_format: string | null;
  status: string;
  is_primary: boolean;
  position: number;
};

type ManifestRangeResult = {
  data: ManifestFixture[] | null;
  error: unknown;
};

function createManifestSupabaseMock(results: ManifestRangeResult[]) {
  const rangeResults = [...results];
  const from = vi.fn();
  const select = vi.fn();
  const eq = vi.fn();
  const inFilter = vi.fn();
  const order = vi.fn();
  const range = vi.fn();

  const query = {
    eq: (column: string, value: unknown) => {
      eq(column, value);
      return query;
    },
    in: (column: string, values: string[]) => {
      inFilter(column, values);
      return query;
    },
    order: (column: string, options?: { ascending: boolean }) => {
      order(column, options);
      return query;
    },
    range: (fromValue: number, toValue: number) => {
      range(fromValue, toValue);
      return Promise.resolve(
        rangeResults.shift() ?? {
          data: [],
          error: null,
        }
      );
    },
    select: (columns: string) => {
      select(columns);
      return query;
    },
  };

  from.mockReturnValue(query);

  return {
    calls: { eq, from, inFilter, order, range, select },
    supabase: { from } as unknown as SupabaseClient,
  };
}

describe('fetchVerifiedOpenAIImageManifest', () => {
  it('returns a verified image manifest grouped by product', async () => {
    const { calls, supabase } = createManifestSupabaseMock([
      {
        data: [
          {
            product_id: 'prod-1',
            verified_url: 'https://cdn.example.com/front.jpg',
            verified_format: 'jpeg',
            status: 'verified',
            is_primary: true,
            position: 0,
          },
          {
            product_id: 'prod-1',
            variant_id: 'var-red',
            verified_url: 'https://cdn.example.com/red.jpg',
            verified_format: 'webp',
            status: 'verified',
            is_primary: false,
            position: 1,
          },
        ],
        error: null,
      },
    ]);

    const result = await fetchVerifiedOpenAIImageManifest(
      supabase,
      'merchant-1',
      ['prod-1']
    );

    expect(calls.from).toHaveBeenCalledWith('product_feed_images');
    expect(calls.select).toHaveBeenCalledWith(
      'product_id, variant_id, source_url, verified_url, verified_format, status, is_primary, position'
    );
    expect(calls.eq).toHaveBeenCalledWith('merchant_id', 'merchant-1');
    expect(calls.eq).toHaveBeenCalledWith('status', 'verified');
    expect(calls.inFilter).toHaveBeenCalledWith('product_id', ['prod-1']);
    expect(calls.order).toHaveBeenCalledWith('product_id', {
      ascending: true,
    });
    expect(calls.order).toHaveBeenCalledWith('position', { ascending: true });
    expect(calls.order).toHaveBeenCalledWith('id', { ascending: true });
    expect(calls.range).toHaveBeenCalledWith(0, 999);
    expect(result).toEqual({
      'prod-1': [
        {
          variant_id: null,
          source_url: null,
          verified_url: 'https://cdn.example.com/front.jpg',
          verified_format: 'jpeg',
          status: 'verified',
          is_primary: true,
          position: 0,
        },
        {
          variant_id: 'var-red',
          source_url: null,
          verified_url: 'https://cdn.example.com/red.jpg',
          verified_format: 'webp',
          status: 'verified',
          is_primary: false,
          position: 1,
        },
      ],
    });
  });

  it('carries source URLs so offer-claim exclusions can match them', async () => {
    const { supabase } = createManifestSupabaseMock([
      {
        data: [
          {
            product_id: 'prod-1',
            source_url: 'https://merchant.example/offer-used.avif',
            verified_url: 'https://cdn.example.com/offer-used.jpg',
            verified_format: 'jpeg',
            status: 'verified',
            is_primary: false,
            position: 3,
          },
        ],
        error: null,
      },
    ]);

    const result = await fetchVerifiedOpenAIImageManifest(
      supabase,
      'merchant-1',
      ['prod-1']
    );

    expect(result?.['prod-1']?.[0]).toMatchObject({
      source_url: 'https://merchant.example/offer-used.avif',
      verified_url: 'https://cdn.example.com/offer-used.jpg',
    });
  });

  it('continues reading manifest pages until the final short page', async () => {
    const firstPage = Array.from({ length: 1000 }, (_, index) => ({
      product_id: 'prod-1',
      verified_url: `https://cdn.example.com/${index}.jpg`,
      verified_format: 'jpeg',
      status: 'verified',
      is_primary: index === 0,
      position: index,
    }));
    const { calls, supabase } = createManifestSupabaseMock([
      { data: firstPage, error: null },
      {
        data: [
          {
            product_id: 'prod-1',
            verified_url: 'https://cdn.example.com/final.jpg',
            verified_format: 'jpeg',
            status: 'verified',
            is_primary: false,
            position: 1000,
          },
        ],
        error: null,
      },
    ]);

    const result = await fetchVerifiedOpenAIImageManifest(
      supabase,
      'merchant-1',
      ['prod-1']
    );

    expect(calls.range).toHaveBeenNthCalledWith(1, 0, 999);
    expect(calls.range).toHaveBeenNthCalledWith(2, 1000, 1999);
    expect(result?.['prod-1']).toHaveLength(1001);
  });

  it('logs and throws when the manifest query fails', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { supabase } = createManifestSupabaseMock([
      {
        data: null,
        error: { message: 'manifest unavailable' },
      },
    ]);

    await expect(
      fetchVerifiedOpenAIImageManifest(supabase, 'merchant-1', ['prod-1'])
    ).rejects.toThrow('Failed to fetch image manifest');
    expect(consoleSpy).toHaveBeenCalledWith(
      'DB_IMAGE_MANIFEST_ERROR:',
      expect.objectContaining({
        batchIndex: 0,
        batchProductCount: 1,
        merchantId: 'merchant-1',
        offset: 0,
      })
    );
    consoleSpy.mockRestore();
  });
});
