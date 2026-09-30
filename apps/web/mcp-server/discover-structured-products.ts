import type { SupabaseClient } from '@supabase/supabase-js';
import type { McpDiscoveryIntent } from '../src/schemas/mcp-discovery-intent';
import { loadStructuredDiscoveryCandidates } from './load-structured-discovery-candidates';
import { hydrateSearchProductAvailability } from './search-product-availability';
import { selectStructuredDiscoveryOffer } from './select-structured-discovery-offer';
import { matchesMcpPostHydrationFilters } from './search-products-query-helpers';
import { selectSearchProductsByPrice } from './select-search-products-by-price';

type Input = {
  intent: McpDiscoveryIntent;
  query?: string;
  args: { category?: string; brand?: string; condition?: string; min_price?: number; max_price?: number; sort?: string; limit?: number };
  merchantId: string;
  supabase: SupabaseClient;
  semanticSearch?: (query: string, offset: number) => Promise<string[]>;
};

/** Structured calls evaluate catalog facts and option prices, never sentence grammar. */
export async function discoverStructuredProducts({ intent, query, args, merchantId, supabase, semanticSearch }: Input) {
  const candidates = await loadStructuredDiscoveryCandidates({ query, merchantId, supabase, semanticSearch });
  const selected = [];
  for (let offset = 0; offset < candidates.products.length; offset += 100) {
    const hydrated = await hydrateSearchProductAvailability(candidates.products.slice(offset, offset + 100)
      .filter((product) => matchesMcpPostHydrationFilters(product, args)), supabase, merchantId, args.condition);
    for (const row of hydrated) {
      const match = selectStructuredDiscoveryOffer(row, intent, args);
      if (match) selected.push(match);
    }
  }
  if (args.sort === 'newest') selected.sort((a, b) =>
    (b.product.created_at ?? '').localeCompare(a.product.created_at ?? '') || a.product.id.localeCompare(b.product.id));
  return {
    selectedProducts: selectSearchProductsByPrice(selected, args, Math.min(20, Math.max(1, args.limit ?? 10))),
    sanitizedQuery: query,
    // Results satisfy constraints even if candidate coverage is bounded.
    priceScanComplete: true,
    coverage: candidates.truncated ? 'partial' as const : 'complete' as const,
    semanticUnavailable: candidates.semanticUnavailable,
  };
}
