import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { loadSemanticDiscoveryCandidateIds } from './semantic-discovery-candidates';

describe('semantic discovery candidates', () => {
  it('keeps only current-model candidates above the relevance threshold', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      embedding: { values: Array(768).fill(0.01) },
    }), { status: 200 })) as unknown as typeof fetch;
    const rpc = vi.fn(async () => ({ data: [
      { product_id: 'relevant', similarity: 0.72 },
      { product_id: 'weak', similarity: 0.4 },
    ], error: null }));
    const ids = await loadSemanticDiscoveryCandidateIds({
      apiKey: 'test-key', fetchImpl, merchantId: 'merchant-1', query: 'office laptop',
      supabase: { rpc } as unknown as SupabaseClient,
    });
    expect(ids).toEqual(['relevant']);
    expect(rpc).toHaveBeenCalledWith('search_product_discovery_embeddings',
      expect.objectContaining({ merchant_id_param: 'merchant-1', result_limit: 40 }));
  });

  it('rejects a semantic lookup error so catalog search can fall back to lexical results', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      embedding: { values: Array(768).fill(0.01) },
    }), { status: 200 })) as unknown as typeof fetch;
    const lookupError = new Error('semantic RPC unavailable');
    const rpc = vi.fn(async () => ({ data: null, error: lookupError }));
    await expect(loadSemanticDiscoveryCandidateIds({
      apiKey: 'test-key', fetchImpl, merchantId: 'merchant-1', query: 'office laptop',
      supabase: { rpc } as unknown as SupabaseClient,
    })).rejects.toBe(lookupError);
  });
});
