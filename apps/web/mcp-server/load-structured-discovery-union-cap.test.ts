import type { SupabaseClient } from '@supabase/supabase-js';
import { expect, it, vi } from 'vitest';
import type { McpDiscoveryIntent } from '../src/schemas/mcp-discovery-intent';
import { loadStructuredDiscoveryCandidates } from './load-structured-discovery-candidates';
import { structuredCandidateTestSupport } from './structured-candidate-test-support';

const { ranked, productRows } = structuredCandidateTestSupport;

it('caps the ranked union at twelve hydration rounds and marks truncation', async () => {
  const lexicalIds = Array.from({ length: 500 }, (_, index) => `lex-${index}`);
  const factIds = Array.from({ length: 500 }, (_, index) => `fact-${index}`);
  const recallIds = Array.from({ length: 500 }, (_, index) => `rec-${index}`);
  const allIds = [...lexicalIds, ...factIds, ...recallIds];
  const rpc = vi.fn(async (name: string, args?: Record<string, unknown>) => {
    if (name === 'search_products_v2') {
      const offset = Number(args?.result_offset ?? 0);
      return { data: ranked(lexicalIds.slice(offset, offset + 100), 500), error: null };
    }
    if (name === 'search_product_discovery_facts') {
      const offset = Number(args?.result_offset ?? 0);
      return { data: ranked(factIds.slice(offset, offset + 100), 500), error: null };
    }
    if (name === 'search_product_variant_recall') {
      return {
        data: recallIds.map((product_id) => ({ product_id, attributes: { storage_gb: 256 } })),
        error: null,
      };
    }
    return { data: null, error: new Error(`Unexpected RPC ${name}`) };
  });
  const from = () => {
    const builder = {
      select: () => builder,
      eq: () => builder,
      in: () => builder,
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve({ data: productRows(allIds), error: null }).then(resolve),
    };
    return builder;
  };
  const intent: McpDiscoveryIntent = {
    alternatives: [{ attributes: [{ key: 'storage_gb', operator: 'eq', value: 256 }] }],
  };
  const result = await loadStructuredDiscoveryCandidates({
    query: 'storage',
    factQuery: '(storage256gb)',
    intent,
    merchantId: 'merchant-1',
    supabase: { rpc, from } as unknown as SupabaseClient,
  });
  expect(result.products).toHaveLength(1200);
  expect(result.truncated).toBe(true);
});
