import type { SupabaseClient } from '@supabase/supabase-js';
import { expect, it, vi } from 'vitest';
import type { McpDiscoveryIntent } from '../src/schemas/mcp-discovery-intent';
import { loadVariantRecallIds } from './load-variant-recall-ids';

type Alternative = McpDiscoveryIntent['alternatives'][number];
const intent = (...alternatives: Alternative[]): McpDiscoveryIntent => ({ alternatives });
const storageEq = (value: number): Alternative => ({ attributes: [{ key: 'storage_gb', operator: 'eq', value }] });
const rpc = (data: unknown, error: unknown = null) =>
  ({ rpc: vi.fn(async () => ({ data, error })) }) as unknown as SupabaseClient;

it('recalls each product once when its variants satisfy a constraint', async () => {
  const result = await loadVariantRecallIds(
    intent(storageEq(256)), 'merchant-1',
    rpc([
      { product_id: 'match', attributes: { Storage: '256GB' } },
      { product_id: 'match', attributes: { storage_gb: 256 } },
      { product_id: 'other', attributes: { Storage: '128GB' } },
    ]));
  expect(result).toEqual({ ids: ['match'], truncated: false });
});

it('skips the scan when no attribute constraints exist', async () => {
  const supabase = rpc([]);
  const result = await loadVariantRecallIds(intent({ product_type: 'phone' }), 'merchant-1', supabase);
  expect(result).toEqual({ ids: [], truncated: false });
  expect(supabase.rpc).not.toHaveBeenCalled();
});

it('reports truncation instead of failing when the recall RPC errors', async () => {
  const result = await loadVariantRecallIds(intent(storageEq(256)), 'merchant-1', rpc(null, new Error('offline')));
  expect(result).toEqual({ ids: [], truncated: true });
});

it('keeps malformed variant rows recalled for the matcher to rule out', async () => {
  const result = await loadVariantRecallIds(
    intent(storageEq(256)), 'merchant-1', rpc([{ product_id: 'odd', attributes: 'not-an-object' }]));
  expect(result).toEqual({ ids: ['odd'], truncated: false });
});

it('flags truncation past the bounded scan window', async () => {
  const rows = Array.from({ length: 2001 }, (_, index) => ({
    product_id: `p-${index % 10}`, attributes: { Storage: '256GB' },
  }));
  const supabase = {
    rpc: vi.fn(async (_name: string, args: { p_limit: number; p_offset: number }) => ({
      data: rows.slice(args.p_offset, args.p_offset + args.p_limit),
      error: null,
    })),
  } as unknown as SupabaseClient;
  const result = await loadVariantRecallIds(intent(storageEq(256)), 'merchant-1', supabase);
  expect(result.truncated).toBe(true);
  expect(result.ids).toHaveLength(10);
  expect(supabase.rpc).toHaveBeenCalledTimes(3);
});

it('stops paging on a short page without probing', async () => {
  const rows = Array.from({ length: 1500 }, (_, index) => ({
    product_id: `p-${index % 10}`, attributes: { Storage: '256GB' },
  }));
  const supabase = {
    rpc: vi.fn(async (_name: string, args: { p_limit: number; p_offset: number }) => ({
      data: rows.slice(args.p_offset, args.p_offset + args.p_limit),
      error: null,
    })),
  } as unknown as SupabaseClient;
  const result = await loadVariantRecallIds(intent(storageEq(256)), 'merchant-1', supabase);
  expect(result).toEqual({ ids: expect.any(Array), truncated: false });
  expect(result.ids).toHaveLength(10);
  expect(supabase.rpc).toHaveBeenCalledTimes(2);
});

it('pushes constraints into the recall RPC so filtering precedes the cap', async () => {
  const supabase = rpc([]);
  await loadVariantRecallIds(intent(storageEq(256)), 'merchant-1', supabase);
  expect(supabase.rpc).toHaveBeenCalledWith('search_product_variant_recall', {
    p_merchant_id: 'merchant-1',
    p_filters: [{ key: 'storage_gb', operator: 'eq', value: 256, branch: 0 }],
    p_identity: [{ branch: 0 }],
    p_limit: 1000,
    p_offset: 0,
  });
});

it('sends each branch identity so the RPC ranks verified products first', async () => {
  const supabase = rpc([]);
  await loadVariantRecallIds(
    intent(
      {
        product_type: 'phone',
        brands: ['Acme'],
        model: 'A1',
        compatible_with: 'USB-C dock',
        attributes: [{ key: 'storage_gb', operator: 'eq', value: 256 }],
      },
      { attributes: [{ key: 'color', operator: 'eq', value: 'Black' }] }
    ),
    'merchant-1',
    supabase
  );
  expect(supabase.rpc).toHaveBeenCalledWith('search_product_variant_recall', {
    p_merchant_id: 'merchant-1',
    p_filters: [
      { key: 'storage_gb', operator: 'eq', value: 256, branch: 0 },
      { key: 'color', operator: 'eq', value: 'Black', branch: 1 },
    ],
    p_identity: [
      {
        branch: 0,
        product_type: 'phone',
        brands: ['Acme'],
        model: 'A1',
        compatible_with: 'USB-C dock',
      },
      { branch: 1 },
    ],
    p_limit: 1000,
    p_offset: 0,
  });
});

it('numbers each alternative branch so the RPC scores branches separately', async () => {
  const supabase = rpc([]);
  await loadVariantRecallIds(
    intent(
      { attributes: [{ key: 'color', operator: 'eq', value: 'Black' }] },
      { attributes: [{ key: 'color', operator: 'eq', value: 'White' }] }
    ),
    'merchant-1',
    supabase
  );
  expect(supabase.rpc).toHaveBeenCalledWith('search_product_variant_recall', {
    p_merchant_id: 'merchant-1',
    p_filters: [
      { key: 'color', operator: 'eq', value: 'Black', branch: 0 },
      { key: 'color', operator: 'eq', value: 'White', branch: 1 },
    ],
    p_identity: [{ branch: 0 }, { branch: 1 }],
    p_limit: 1000,
    p_offset: 0,
  });
});
