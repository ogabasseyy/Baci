import type { SupabaseClient } from '@supabase/supabase-js';
import { vi } from 'vitest';

function setup({ lexicalPages, products, failHydrationCalls = [] }: {
  lexicalPages: unknown[][];
  failHydrationCalls?: number[];
  products: Array<Record<string, unknown>>;
}) {
  let rpcPage = 0;
  const rpc = vi.fn(async (name: string) => ({ data: name === 'search_product_discovery_facts' ? [] : lexicalPages[rpcPage++] ?? [], error: null as Error | null }));
  const queryCalls: Array<{ table: string; calls: unknown[][] }> = [];
  const from = vi.fn((table: string) => {
    const calls: unknown[][] = [];
    queryCalls.push({ table, calls });
    const fail = failHydrationCalls.includes(queryCalls.length);
    const builder = {
      select: vi.fn((...args: unknown[]) => { calls.push(['select', ...args]); return builder; }),
      eq: vi.fn((...args: unknown[]) => { calls.push(['eq', ...args]); return builder; }),
      in: vi.fn((...args: unknown[]) => { calls.push(['in', ...args]); return builder; }),
      order: vi.fn((...args: unknown[]) => { calls.push(['order', ...args]); return builder; }),
      range: vi.fn((...args: unknown[]) => { calls.push(['range', ...args]); return builder; }),
      then: undefined as unknown,
    };
    Object.assign(builder, {
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(fail ? {data: null, error: new Error('batch unavailable')} : { data: products, error: null }).then(resolve),
    });
    return builder;
  });
  return {
    supabase: { rpc, from } as unknown as SupabaseClient,
    rpc,
    from,
    queryCalls,
  };
}

const ranked = (ids: string[], total = ids.length) => ids.map((product_id) => ({ product_id, total_count: total }));
const productRows = (ids: string[]) => ids.map((id) => ({ id, name: id }));

export const structuredCandidateTestSupport = { setup, ranked, productRows };
