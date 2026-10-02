import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { loadDiscoveryFactCandidates } from './load-discovery-fact-candidates';

describe('verified fact retrieval', () => {
  it.each([500, 501])('reports coverage for %s matching fact documents', async (total) => {
    const rpc = vi.fn(async (_name, args) => ({data: Array.from({length: 100}, (_, i) => ({product_id: `${args.result_offset + i}`, total_count: total})), error: null}));
    const result = await loadDiscoveryFactCandidates('ZX-42', 'merchant', {rpc} as unknown as SupabaseClient);
    expect(result.ids).toHaveLength(500);
    expect(result.truncated).toBe(total > 500);
    expect(rpc).toHaveBeenCalledTimes(5);
  });
  it('retains confirmed fact IDs when the next RPC promise rejects', async () => {
    const rpc = vi.fn().mockResolvedValueOnce({data: Array.from({length: 100}, (_, i) => ({product_id: String(i), total_count: 120})), error: null})
      .mockRejectedValueOnce(new Error('network unavailable'));
    const result = await loadDiscoveryFactCandidates('ZX-42', 'merchant', {rpc} as unknown as SupabaseClient);
    expect(result.ids).toHaveLength(100);
    expect(result.truncated).toBe(true);
  });

  it('forwards the requested condition so the RPC narrows before the cap', async () => {
    const rpc = vi.fn(async () => ({ data: [], error: null }));
    await loadDiscoveryFactCandidates('ZX-42', 'merchant', { rpc } as unknown as SupabaseClient, {
      condition: 'used',
    });
    expect(rpc).toHaveBeenCalledWith('search_product_discovery_facts', expect.objectContaining({
      condition_filter: 'used',
    }));
  });

  it('retains confirmed IDs and marks partial coverage when a facts page fails', async () => {
    const rpc = vi.fn().mockResolvedValueOnce({data: Array.from({length: 100}, (_, i) => ({product_id: String(i), total_count: 120})), error: null})
      .mockResolvedValueOnce({data: null, error: {code: 'unavailable'}});
    const result = await loadDiscoveryFactCandidates('ZX-42', 'merchant', {rpc} as unknown as SupabaseClient);
    expect(result.ids).toHaveLength(100);
    expect(result.truncated).toBe(true);
  });
});
