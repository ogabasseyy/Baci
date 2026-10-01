import type { SupabaseClient } from '@supabase/supabase-js';
import type { McpDiscoveryIntent } from '../src/schemas/mcp-discovery-intent';
import { buildDiscoveryFactRetrievalQuery } from './build-discovery-fact-retrieval-query';
import { loadStructuredDiscoveryCandidates } from './load-structured-discovery-candidates';
import { hydrateSearchProductAvailability } from './search-product-availability';
import { isStructuredDiscoveryRowExcludedByIdentity, selectStructuredDiscoveryOffer } from './select-structured-discovery-offer';
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
  const factQuery = buildDiscoveryFactRetrievalQuery(intent, query);
  const candidates = await loadStructuredDiscoveryCandidates({
    query, factQuery, brand: args.brand, category: args.category, merchantId, supabase, semanticSearch,
  });
  const selected = [];
  let optionsLookupFailed = false;
  let factsUnverified = false;
  for (let offset = 0; offset < candidates.products.length; offset += 100) {
    // Option-capable rows skip the condition pre-filter: a stale or empty
    // available_conditions snapshot must not drop the product before its live
    // offers/variants hydrate, and hydration enforces the requested condition per
    // option (offers, variants, and base eligibility).
    const hydrated = await hydrateSearchProductAvailability(candidates.products.slice(offset, offset + 100)
      .filter((product) => product.has_condition_offers === true || product.has_variants === true
        ? matchesMcpPostHydrationFilters(product, { brand: args.brand, category: args.category })
        : matchesMcpPostHydrationFilters(product, args)), supabase, merchantId, args.condition);
    for (const row of hydrated) {
      const match = selectStructuredDiscoveryOffer(row, intent, args, () => { factsUnverified = true; });
      if (match) selected.push(match);
      // A lookup failure only vetoes the scan when the row could still satisfy
      // the intent; rows ruled out by verified product facts cannot change the
      // result no matter what their missing options contained.
      if (row.optionsLookupFailed && (match !== undefined || !isStructuredDiscoveryRowExcludedByIdentity(row, intent))) {
        optionsLookupFailed = true;
      }
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
