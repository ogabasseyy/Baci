import { describe, expect, it, vi } from 'vitest';
import { appendOfferImageCandidates } from './feed-offer-image-backfill';

/** Recording PostgREST chain stub over canned offer pages. */
function stubSupabase(pages: Array<{ data: unknown[] } | { error: string }>) {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const chain: Record<string, (...args: unknown[]) => unknown> = {};
  const terminal = () => {
    const page = pages.shift() ?? { data: [] };
    if ('error' in page) return { data: null, error: { message: page.error } };
    return { data: page.data, error: null };
  };
  for (const method of ['select', 'in', 'eq', 'order', 'range']) {
    chain[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return method === 'range' ? terminal() : chain;
    };
  }
  return {
    calls,
    supabase: { from: vi.fn(() => chain) } as never,
  };
}

const OFFER = {
  id: 'o1',
  product_id: 'p1',
  images: ['https://cdn.example/offer.jpg'],
};

describe('appendOfferImageCandidates', () => {
  it('scopes the offer query to the resolved merchant', async () => {
    const { calls, supabase } = stubSupabase([{ data: [OFFER] }]);
    await appendOfferImageCandidates({
      supabase,
      productIds: ['p1'],
      merchantId: 'm-1',
      storefrontBaseUrl: 'https://store.example',
      productRows: [],
    });
    const eqCalls = calls.filter((call) => call.method === 'eq');
    expect(eqCalls).toContainEqual({ method: 'eq', args: ['merchant_id', 'm-1'] });
    expect(eqCalls).toContainEqual({ method: 'eq', args: ['status', 'active'] });
  });

  it('merges offer candidates without duplicating product urls', async () => {
    const { supabase } = stubSupabase([{ data: [OFFER] }]);
    const rows = await appendOfferImageCandidates({
      supabase,
      productIds: ['p1'],
      merchantId: 'm-1',
      storefrontBaseUrl: 'https://store.example',
      productRows: [],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].candidate.is_primary).toBe(false);
    expect(rows[0].candidate.source_url).toBe('https://cdn.example/offer.jpg');

    const rerun = await appendOfferImageCandidates({
      supabase: stubSupabase([{ data: [OFFER] }]).supabase,
      productIds: ['p1'],
      merchantId: 'm-1',
      storefrontBaseUrl: 'https://store.example',
      productRows: rows,
    });
    expect(rerun).toHaveLength(0);
  });

  it('throws loudly on query failure', async () => {
    const { supabase } = stubSupabase([{ error: 'boom' }]);
    await expect(
      appendOfferImageCandidates({
        supabase,
        productIds: ['p1'],
        merchantId: 'm-1',
        storefrontBaseUrl: 'https://store.example',
        productRows: [],
      })
    ).rejects.toThrow('Failed to fetch product offer images: boom');
  });
});
