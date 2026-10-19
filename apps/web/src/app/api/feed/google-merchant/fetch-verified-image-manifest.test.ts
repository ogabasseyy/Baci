import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import {
  fetchVerifiedImageManifestRows,
  type ManifestRow,
} from './fetch-verified-image-manifest';

interface MockPage {
  data?: ManifestRow[] | null;
  error?: unknown;
}

function createManifestSupabase(pages: MockPage[]) {
  let call = 0;
  const ranges: Array<{ from: number; to: number }> = [];
  const inCalls: Array<{ column: string; ids: string[] }> = [];
  const query = {
    eq: () => query,
    in: (column: string, ids: string[]) => {
      inCalls.push({ column, ids });
      return query;
    },
    order: () => query,
    range: (from: number, to: number) => {
      ranges.push({ from, to });
      return query;
    },
    overrideTypes: () => {
      const page = pages[call] ?? { data: [] };
      call += 1;
      return Promise.resolve({
        data: page.data ?? null,
        error: page.error ?? null,
      });
    },
  };
  const supabase = {
    from: (table: string) =>
      table === 'product_feed_images' ? { select: () => query } : {},
  } as unknown as SupabaseClient;
  return { supabase, ranges, inCalls };
}

const manifestRow = (product_id: string, position: number): ManifestRow => ({
  product_id,
  source_url: `https://cdn.example/${product_id}-${position}.jpg`,
  variant_id: null,
  verified_url: `https://cdn.example/${product_id}-${position}.jpg`,
  verified_format: 'jpg',
  status: 'verified',
  is_primary: position === 0,
  position,
});

describe('fetchVerifiedImageManifestRows', () => {
  it('returns verified manifest rows for the requested products', async () => {
    const { supabase, ranges } = createManifestSupabase([
      { data: [manifestRow('p1', 0), manifestRow('p1', 1)] },
    ]);

    const rows = await fetchVerifiedImageManifestRows(supabase, 'm1', ['p1']);

    expect(rows).toHaveLength(2);
    expect(ranges[0]).toEqual({ from: 0, to: 999 });
  });

  it('advances the offset across full pages', async () => {
    const fullPage = Array.from({ length: 1000 }, (_, index) =>
      manifestRow('p1', index)
    );
    const { supabase, ranges } = createManifestSupabase([
      { data: fullPage },
      { data: [manifestRow('p1', 1000)] },
    ]);

    const rows = await fetchVerifiedImageManifestRows(supabase, 'm1', ['p1']);

    expect(rows).toHaveLength(1001);
    expect(ranges.map((r) => r.from)).toEqual([0, 1000]);
  });

  it('merges rows across product batches above the batch size', async () => {
    const productIds = Array.from({ length: 251 }, (_, index) => `p${index}`);
    const { supabase, inCalls } = createManifestSupabase([
      { data: [manifestRow('p0', 0)] },
      { data: [manifestRow('p250', 0)] },
    ]);

    const rows = await fetchVerifiedImageManifestRows(
      supabase,
      'm1',
      productIds
    );

    expect(inCalls).toEqual([
      { column: 'product_id', ids: productIds.slice(0, 250) },
      { column: 'product_id', ids: ['p250'] },
    ]);
    expect(rows.map((r) => r.product_id)).toEqual(['p0', 'p250']);
  });

  it('returns an empty list for no products without querying', async () => {
    const { supabase, ranges } = createManifestSupabase([]);

    await expect(
      fetchVerifiedImageManifestRows(supabase, 'm1', [])
    ).resolves.toEqual([]);
    expect(ranges).toEqual([]);
  });

  it('throws when the manifest query fails', async () => {
    const { supabase } = createManifestSupabase([
      { error: { message: 'db down' } },
    ]);

    await expect(
      fetchVerifiedImageManifestRows(supabase, 'm1', ['p1'])
    ).rejects.toThrow('Failed to fetch image manifest');
  });
});
