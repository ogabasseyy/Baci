import type { SupabaseClient } from '@supabase/supabase-js';
import type { McpDiscoveryIntent } from '../src/schemas/mcp-discovery-intent';
import { buildDiscoveryFactRetrievalQuery } from './build-discovery-fact-retrieval-query';
import { loadStructuredDiscoveryCandidates } from './load-structured-discovery-candidates';
import { hydrateSearchProductAvailability } from './search-product-availability';
import { selectStructuredDiscoveryOffer } from './select-structured-discovery-offer';
import { structuredDiscoveryIdentity } from './structured-discovery-identity';
import { toGoogleListingCondition } from '@baci/shared/lib';
import { matchesMcpPostHydrationFilters } from './search-products-query-helpers';
import { selectSearchProductsByPrice } from './select-search-products-by-price';

type HydratedRow = Awaited<ReturnType<typeof hydrateSearchProductAvailability>>[number];
type SelectedMatch = ReturnType<typeof selectStructuredDiscoveryOffer>;

// A lookup failure only vetoes the scan when the row's missing options could
// have produced a different result. Rows ruled out by verified product facts
// cannot change the result. Source-scoped: variant failures always matter
// because variants are the primary purchase path, and serialized failures
// always matter because the row's price and stock fell back to stored values
// that may be stale; offer failures matter only when a missing offer could
// still be selected — with no requested condition any offer could win, while
// a requested condition matching the parent's listing rules every missing
// offer ineligible by design (the same-condition skip in
// select-structured-discovery-offer).
function lookupFailureCouldMatter(
  row: HydratedRow,
  intent: McpDiscoveryIntent,
  match: SelectedMatch,
  requestedCondition: string | undefined,
): boolean {
  if (!row.optionsLookupFailed) return false;
  if (match === undefined && structuredDiscoveryIdentity.isRowExcludedByIdentity(row, intent)) return false;
  if (row.variantLookupFailed) return true;
  if (row.serializedLookupFailed) return true;
  if (!row.offerLookupFailed) return false;
  // Variants owning the condition axis disable offers entirely (PDP parity),
  // so an offer-only failure cannot change selection with or without a
  // requested condition.
  if (structuredDiscoveryIdentity.variantsOwnConditionAxis(
    row.product as Record<string, unknown>, row.allVariants ?? row.availableVariants)) return false;
  if (!requestedCondition) return true;
  const product = row.product as Record<string, unknown>;
  const parentCondition = typeof product.condition === 'string' ? product.condition : null;
  return toGoogleListingCondition(requestedCondition) !== (toGoogleListingCondition(parentCondition) ?? 'new');
}

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
    query, factQuery, intent, brand: args.brand, category: args.category, merchantId, supabase, semanticSearch,
  });
  const selected = [];
  let optionsLookupFailed = false;
  let factsUnverified = false;
  let variantWindowTruncated = false;
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
      // PDP parity: the storefront snapshot refuses products past the
      // 128-variant window as unavailable with no fallback, so serving the
      // match would link to an unusable PDP. Exclude the row; coverage
      // already reports partial for the truncation.
      if (match && !row.variantWindowTruncated) selected.push(match);
      if (lookupFailureCouldMatter(row, intent, match, args.condition)) optionsLookupFailed = true;
      // Truncation on a definitively excluded row cannot hide a match: the
      // verified identity already rules out every alternative (same veto as
      // lookup failures), so it must not invalidate an ordered scan.
      if (row.variantWindowTruncated && !(match === undefined &&
        structuredDiscoveryIdentity.isRowExcludedByIdentity(row, intent))) variantWindowTruncated = true;
    }
  }
  if (args.sort === 'newest') selected.sort((a, b) =>
    (b.product.created_at ?? '').localeCompare(a.product.created_at ?? '') || a.product.id.localeCompare(b.product.id));
  const orderedCoverageIncomplete = (candidates.truncated || variantWindowTruncated) &&
    (args.min_price !== undefined || args.max_price !== undefined || args.sort === 'price_asc' || args.sort === 'price_desc' || args.sort === 'newest');
  // Fact-only retrieval (no free-text query) fetches only rows already
  // carrying the requested facts: products with missing discovery metadata
  // are never hydrated, so unverified-fact detection cannot run for them.
  // Claiming complete coverage would be dishonest when constrained
  // retrieval may have excluded unknown rows, so this path reports partial.
  const factOnlyConstrained = (query ?? '').trim() === '' && intent.alternatives.some(
    ({ product_type, brands, model, compatible_with, attributes }) =>
      product_type !== undefined || (brands ?? []).length > 0 || model !== undefined ||
      compatible_with !== undefined || (attributes ?? []).length > 0);
  return {
    selectedProducts: selectSearchProductsByPrice(selected, args, Math.min(20, Math.max(1, args.limit ?? 10))),
    sanitizedQuery: query,
    priceScanComplete: !optionsLookupFailed && !orderedCoverageIncomplete,
    incompleteReason: optionsLookupFailed ? 'option_lookup_failed' as const :
      orderedCoverageIncomplete ? 'candidate_limit' as const : undefined,
    coverage: candidates.truncated || optionsLookupFailed || factsUnverified || factOnlyConstrained || variantWindowTruncated ? 'partial' as const : 'complete' as const,
    semanticUnavailable: candidates.semanticUnavailable,
  };
}
