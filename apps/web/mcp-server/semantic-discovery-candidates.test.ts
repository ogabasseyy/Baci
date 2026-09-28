import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { loadSemanticDiscoveryCandidateIds } from './semantic-discovery-candidates';

describe('semantic discovery candidates', () => {
  it('keeps only current-model candidates above the relevance threshold', async () => {
    const embedding = Array(768).fill(0.01) as number[];
    const rpc = vi.fn(async () => ({ data: [
      { product_id: 'relevant', similarity: 0.72 },
      { product_id: 'weak', similarity: 0.4 },
    ], error: null }));
    const ids = await loadSemanticDiscoveryCandidateIds({
      embedding, merchantId: 'merchant-1',
      supabase: { rpc } as unknown as SupabaseClient,
    });
    expect(ids).toEqual(['relevant']);
    expect(rpc).toHaveBeenCalledWith('search_product_discovery_embeddings',
      expect.objectContaining({ merchant_id_param: 'merchant-1', result_limit: 40, result_offset: 0 }));
  });

  it('forwards the semantic page offset to the merchant-scoped RPC', async () => {
    const embedding = Array(768).fill(0.01) as number[];
    const rpc = vi.fn(async () => ({ data: [], error: null }));
    await loadSemanticDiscoveryCandidateIds({
      embedding, merchantId: 'merchant-1', offset: 40,
      supabase: { rpc } as unknown as SupabaseClient,
    });
    expect(rpc).toHaveBeenCalledWith('search_product_discovery_embeddings',
      expect.objectContaining({ result_offset: 40 }));
  });

  it('rejects a semantic lookup error so catalog search can fall back to lexical results', async () => {
    const embedding = Array(768).fill(0.01) as number[];
    const lookupError = new Error('semantic RPC unavailable');
    const rpc = vi.fn(async () => ({ data: null, error: lookupError }));
    await expect(loadSemanticDiscoveryCandidateIds({
      embedding, merchantId: 'merchant-1',
      supabase: { rpc } as unknown as SupabaseClient,
    })).rejects.toBe(lookupError);
  });
});
