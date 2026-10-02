import type { SupabaseClient } from '@supabase/supabase-js';
import type { McpDiscoveryIntent } from '../src/schemas/mcp-discovery-intent';
import { buildDiscoveryFactRetrievalQuery } from './build-discovery-fact-retrieval-query';
import { loadDiscoveryFactCandidates } from './load-discovery-fact-candidates';
import { loadVariantRecallIds } from './load-variant-recall-ids';
import { DISCOVERY_PRODUCT_PROJECTION } from './discovery-product-projection';
import { buildSearchProductsV2RpcArgs } from './search-products-ranking';
import {
  extractRankedProductIds,
  getRankedProductTotal,
  toMcpSearchProductRows,
  toRankedSearchProductRows,
  type McpSearchProductRow,
} from './search-products-query-helpers';

const LEXICAL_PAGE_SIZE = 100;
const MAX_LEXICAL_CANDIDATES = 500;
const SEMANTIC_PAGE_SIZE = 40;
const MAX_SEMANTIC_CANDIDATES = 200;
// Twelve hydration rounds of 100: the pre-recall union budget. Recall's
// 2,000-row window must not turn one search into 32 serial hydration rounds.
const MAX_STRUCTURED_CANDIDATE_PRODUCTS = 1200;

type LoadStructuredDiscoveryCandidatesInput = {
  query?: string;
  factQuery?: string;
  intent?: McpDiscoveryIntent;
  brand?: string;
  category?: string;
  condition?: string;
  sort?: string;
  merchantId: string;
  supabase: SupabaseClient;
  semanticSearch?: (query: string, offset: number) => Promise<string[]>;
};

type BrowseFilters = { brand?: string; category?: string; condition?: string; sort?: string; excludedTypes?: string[] };

type SearchProductsArgs = { sort: 'relevance' };

// Brand/category narrow server-side for the facts and browse sources, but the
// lexical RPC keeps the legacy contract (null filters, post-filter with an
// over-fetch buffer), so highly selective filters can fill the lexical cap
// with rows the post-filter drops. The scan reports partial coverage instead
// of silently dropping matches.
async function loadLexicalIds(
  query: string,
  merchantId: string,
  supabase: SupabaseClient
) {
  const ids: string[] = [];
  let offset = 0;
  let total = Number.POSITIVE_INFINITY;
  let totalIsAuthoritative = false;
  let truncated = false;

  try {
    while ((!totalIsAuthoritative || offset < total) && offset < MAX_LEXICAL_CANDIDATES) {
      const { data, error } = await supabase.rpc(
        'search_products_v2',
        buildSearchProductsV2RpcArgs({
          args: { sort: 'relevance' } satisfies SearchProductsArgs,
          forcePostFilterBuffer: true,
          limit: LEXICAL_PAGE_SIZE,
          merchantId,
          offset,
          sanitizedQuery: query,
        })
      );
      if (error) throw error;

      const rows = toRankedSearchProductRows(data);
      const pageIds = extractRankedProductIds(rows);
      const reportedTotal = getRankedProductTotal(rows);
      const hasReportedTotal = rows[0]?.total_count !== undefined && rows[0]?.total_count !== null;
      totalIsAuthoritative = hasReportedTotal;
      total = hasReportedTotal ? reportedTotal : offset + pageIds.length;
      ids.push(...pageIds);
      if (pageIds.length < LEXICAL_PAGE_SIZE) break;
      offset += LEXICAL_PAGE_SIZE;
    }
  } catch {
    return { ids: uniqueIds(ids), truncated: true };
  }

  if (ids.length >= MAX_LEXICAL_CANDIDATES) {
    // At the hard cap, only an authoritative count at or below the cap proves
    // that this lexical source was exhausted.
    truncated = !totalIsAuthoritative || total > MAX_LEXICAL_CANDIDATES;
  }
  return { ids: uniqueIds(ids), truncated };
}

function uniqueIds(ids: string[]) {
  return [...new Set(ids)];
}

async function loadSemanticIds(
  query: string,
  semanticSearch: NonNullable<LoadStructuredDiscoveryCandidatesInput['semanticSearch']>
) {
  const ids: string[] = [];
  try {
    for (let offset = 0; offset < MAX_SEMANTIC_CANDIDATES; offset += SEMANTIC_PAGE_SIZE) {
      const page = await semanticSearch(query, offset);
      ids.push(...page);
      if (page.length < SEMANTIC_PAGE_SIZE) break;
    }
  } catch {
    return { ids: uniqueIds(ids), truncated: true, probeFailed: true };
  }
  if (ids.length < MAX_SEMANTIC_CANDIDATES) return { ids: uniqueIds(ids), truncated: false, probeFailed: false };
  try {
    const next = await semanticSearch(query, MAX_SEMANTIC_CANDIDATES);
    return { ids: uniqueIds(ids), truncated: next.length > 0, probeFailed: false };
  } catch {
    // Keep confirmed candidates, but do not claim the source was exhausted.
    return { ids: uniqueIds(ids), truncated: true, probeFailed: true };
  }
}

async function loadBrowseRows(merchantId: string, supabase: SupabaseClient, filters: BrowseFilters) {
  // The browse window is an arbitrary UUID slice, so brand/category narrow it
  // server-side instead of filtering after the cap, and a newest sort orders
  // server-side too. The RPC applies the same ASCII-only substring
  // comparison as the post-hydration filter (ilike would fold non-ASCII
  // case per the database locale and strand genuine matches past the cap).
  // Intent-level excluded types ride along for the same reason: hydration
  // rejects them, so admitting them would strand valid rows past the cap.
  const fetchPage = async (limit: number, offset: number) => {
    const { data, error } = await supabase.rpc('search_products_browse', {
      p_merchant_id: merchantId,
      p_brand: filters.brand,
      p_category: filters.category,
      p_sort: filters.sort,
      p_condition: filters.condition,
      p_excluded_types: filters.excludedTypes,
      p_limit: limit,
      p_offset: offset,
    });
    if (error) throw error;
    return toMcpSearchProductRows(data);
  };
  const products: McpSearchProductRow[] = [];
  try {
    for (let offset = 0; offset < MAX_LEXICAL_CANDIDATES; offset += LEXICAL_PAGE_SIZE) {
      const rows = await fetchPage(LEXICAL_PAGE_SIZE, offset);
      products.push(...rows);
      if (rows.length < LEXICAL_PAGE_SIZE) return { products, truncated: false };
    }
    const next = await fetchPage(1, MAX_LEXICAL_CANDIDATES);
    return { products, truncated: next.length > 0 };
  } catch {
    return { products, truncated: true };
  }
}

function reciprocalRankFusion(...groups: string[][][]) {
  const scores = new Map<string, number>();
  for (const sources of groups) {
    const groupScores = new Map<string, number>();
    for (const ids of sources) {
      for (const [rank, id] of ids.entries()) {
        groupScores.set(id, Math.max(groupScores.get(id) ?? 0, 1 / (60 + rank + 1)));
      }
    }
    for (const [id, score] of groupScores) scores.set(id, (scores.get(id) ?? 0) + score);
  }
  return [...scores].sort(([idA, scoreA], [idB, scoreB]) =>
    scoreB - scoreA || idA.localeCompare(idB)
  ).map(([id]) => id);
}

export async function loadStructuredDiscoveryCandidates({
  query,
  factQuery,
  intent,
  brand,
  category,
  condition,
  sort,
  merchantId,
  supabase,
  semanticSearch,
}: LoadStructuredDiscoveryCandidatesInput): Promise<{
  products: McpSearchProductRow[];
  truncated: boolean;
  semanticUnavailable: boolean;
}> {
  if (!query && (!factQuery || factQuery === '(a & !a)')) {
    const result = await loadBrowseRows(merchantId, supabase, { brand, category, condition, sort, excludedTypes: intent?.excluded_product_types });
    return { products: result.products, truncated: result.truncated, semanticUnavailable: false };
  }

  const lexicalPromise = query ? loadLexicalIds(query, merchantId, supabase) : Promise.resolve({ ids: [], truncated: false });
  const semanticPromise = query && semanticSearch
    ? loadSemanticIds(query, semanticSearch).then(
      (value) => ({ value, unavailable: value.probeFailed }),
      () => ({ value: { ids: [], truncated: true }, unavailable: true })
    )
    : Promise.resolve({ value: { ids: [], truncated: false }, unavailable: false });
  const [lexical, semantic, facts, variants] = await Promise.all([
    lexicalPromise, semanticPromise,
    loadDiscoveryFactCandidates(factQuery || query || '(a & !a)', merchantId, supabase, { brand, category, condition }),
    loadVariantRecallIds(intent, merchantId, supabase, { brand, category, condition }),
  ]);
  // Free-text relevance votes independently from structured-fact votes
  // (facts plus variant recall), so an exact keyword hit that also satisfies
  // the structured facts outranks a fact-only match instead of tying it.
  // But an unconstrained browse emits no structured terms, so the fact
  // query falls back to the same free-text query: a separate group would
  // double-count keyword evidence against semantic-only candidates. Rebuild
  // with an empty fallback to detect that case exactly (the builder is pure)
  // and fuse lexical with fallback-fact IDs into one max-scored group.
  const hasStructuredFactTerms = intent !== undefined &&
    buildDiscoveryFactRetrievalQuery(intent, '') !== '(a & !a)';
  const rankedIds = hasStructuredFactTerms
    ? reciprocalRankFusion([lexical.ids], [facts.ids, variants.ids], [semantic.value.ids])
    : reciprocalRankFusion([lexical.ids, facts.ids], [variants.ids], [semantic.value.ids]);
  // RRF order keeps the best candidates; overflow past the global budget
  // marks truncation like any other cap instead of hydrating silently.
  const cappedIds = rankedIds.slice(0, MAX_STRUCTURED_CANDIDATE_PRODUCTS);
  const unionTruncated = cappedIds.length < rankedIds.length;
  const products: McpSearchProductRow[] = [];

  let hydrationFailed = false;
  for (let offset = 0; offset < cappedIds.length; offset += LEXICAL_PAGE_SIZE) {
    const batch = cappedIds.slice(offset, offset + LEXICAL_PAGE_SIZE);
    try {
      const { data, error } = await supabase
        .from('products')
        .select(DISCOVERY_PRODUCT_PROJECTION)
        .eq('merchant_id', merchantId)
        .eq('status', 'active')
        .in('id', batch);
      if (error) throw error;
      const byId = new Map(toMcpSearchProductRows(data).map((product) => [product.id, product]));
      products.push(...batch.flatMap((id) => {
        const product = byId.get(id);
        return product ? [product] : [];
      }));
    } catch {
      hydrationFailed = true;
    }
  }

  // Ranked IDs that vanish before hydration (RLS filtering, deletes) are silent
  // coverage loss, so they mark the scan truncated like any other cap.
  const hydrationDroppedIds = products.length < cappedIds.length;
  return {
    products,
    truncated: lexical.truncated || semantic.value.truncated || facts.truncated || variants.truncated || unionTruncated || hydrationFailed || hydrationDroppedIds,
    semanticUnavailable: semantic.unavailable,
  };
}
