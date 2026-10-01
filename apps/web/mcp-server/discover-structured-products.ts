import type { SupabaseClient } from '@supabase/supabase-js';
import type { McpDiscoveryIntent } from '../src/schemas/mcp-discovery-intent';
import { buildDiscoveryFactRetrievalQuery } from './build-discovery-fact-retrieval-query';
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
  const factQuery = buildDiscoveryFactRetrievalQuery(intent) || query;
  const candidates = await loadStructuredDiscoveryCandidates({ query, factQuery, merchantId, supabase, semanticSearch });
  const selected = [];
  let optionsLookupFailed = false;
  let factsUnverified = false;
  for (let offset = 0; offset < candidates.products.length; offset += 100) {
    const hydrated = await hydrateSearchProductAvailability(candidates.products.slice(offset, offset + 100)
      .filter((product) => matchesMcpPostHydrationFilters(product, args)), supabase, merchantId, args.condition);
    optionsLookupFailed ||= hydrated.some((row) => row.optionsLookupFailed);
    for (const row of hydrated) {
      const match = selectStructuredDiscoveryOffer(row, intent, args, () => { factsUnverified = true; });
      if (match) selected.push(match);
    }
  }
  if (args.sort === 'newest') selected.sort((a, b) =>
    (b.product.created_at ?? '').localeCompare(a.product.created_at ?? '') || a.product.id.localeCompare(b.product.id));
  const orderedCoverageIncomplete = candidates.truncated &&
    (args.min_price !== undefined || args.max_price !== undefined || args.sort === 'price_asc' || args.sort === 'price_desc' || args.sort === 'newest');
  return {
    selectedProducts: selectSearchProductsByPrice(selected, args, Math.min(20, Math.max(1, args.limit ?? 10))),
    sanitizedQuery: query,
    priceScanComplete: !optionsLookupFailed && !orderedCoverageIncomplete,
    incompleteReason: optionsLookupFailed ? 'option_lookup_failed' as const :
      orderedCoverageIncomplete ? 'candidate_limit' as const : undefined,
    coverage: candidates.truncated || optionsLookupFailed || factsUnverified ? 'partial' as const : 'complete' as const,
    semanticUnavailable: candidates.semanticUnavailable,
  };
}
