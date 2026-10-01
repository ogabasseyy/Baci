import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { backfillDiscoveryBatch } from './backfill-discovery-batch';
import { discoveryEmbeddingSource } from './discovery-embedding-source';

const product = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Aroma Machine', brand: null, category: 'Accessories',
  description: 'Fragrance diffuser for rooms',
};

function client(priorHash?: string, writeError: unknown = null) {
  const gt = vi.fn(async () => ({ data: [product], error: null }));
  const productQuery = {
    select: vi.fn(() => productQuery),
    eq: vi.fn(() => productQuery),
    order: vi.fn(() => productQuery),
    limit: vi.fn(() => Object.assign(Promise.resolve({ data: [product], error: null }), { gt })),
  };
  const priorQuery = {
    select: vi.fn(() => priorQuery),
    eq: vi.fn(() => priorQuery),
    in: vi.fn(async () => ({
      data: priorHash ? [{ product_id: product.id, source_hash: priorHash }] : [],
      error: null,
    })),
    upsert: vi.fn(async () => ({ error: writeError })),
  };
  const supabase = {
    from: vi.fn((table: string) => table === 'products' ? productQuery : priorQuery),
  } as unknown as SupabaseClient;
  return { supabase, productQuery, priorQuery, gt };
}

describe('merchant-session discovery batch', () => {
  it('generates the same source hash as the operator backfill and writes under the merchant', async () => {
    const { supabase, priorQuery } = client();
    const embed = vi.fn(async () => Array(768).fill(0.1));
    const result = await backfillDiscoveryBatch({
      supabase, merchantId: 'merchant-1', cursor: null, geminiKey: 'private-test-key', embed,
    });
    expect(result).toEqual({ scanned: 1, generated: 1, nextCursor: product.id, done: true });
    expect(embed).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'document', title: product.name, text: expect.stringContaining('Fragrance diffuser'),
    }));
    expect(priorQuery.upsert).toHaveBeenCalledWith(expect.objectContaining({
      merchant_id: 'merchant-1', product_id: product.id,
      source_hash: discoveryEmbeddingSource(product).sourceHash,
    }));
  });

  it('skips unchanged rows and resumes after the provided cursor', async () => {
    const { supabase, gt, priorQuery } = client(discoveryEmbeddingSource(product).sourceHash);
    const embed = vi.fn(async () => Array(768).fill(0.1));
    const result = await backfillDiscoveryBatch({
      supabase, merchantId: 'merchant-1', cursor: '00000000-0000-4000-8000-000000000001',
      geminiKey: 'private-test-key', embed,
    });
    expect(gt).toHaveBeenCalledWith('id', '00000000-0000-4000-8000-000000000001');
    expect(result.generated).toBe(0);
    expect(embed).not.toHaveBeenCalled();
    expect(priorQuery.upsert).not.toHaveBeenCalled();
  });

  it('fails the batch when a vector cannot be stored so the same cursor can be retried', async () => {
    const { supabase } = client(undefined, { code: '42501' });
    await expect(backfillDiscoveryBatch({
      supabase, merchantId: 'merchant-1', cursor: null, geminiKey: 'private-test-key',
      embed: async () => Array(768).fill(0.1),
    })).rejects.toThrow('Embedding write failed: 42501');
  });
});
