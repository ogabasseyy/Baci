import type { SupabaseClient } from '@supabase/supabase-js';
import { loadDiscoveryFactCandidates } from './load-discovery-fact-candidates';
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

type LoadStructuredDiscoveryCandidatesInput = {
  query?: string;
  merchantId: string;
  supabase: SupabaseClient;
  semanticSearch?: (query: string, offset: number) => Promise<string[]>;
};

type SearchProductsArgs = { sort: 'relevance' };

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

async function loadBrowseRows(merchantId: string, supabase: SupabaseClient) {
  const products: McpSearchProductRow[] = [];
  try {
    for (let offset = 0; offset < MAX_LEXICAL_CANDIDATES; offset += LEXICAL_PAGE_SIZE) {
      const { data, error } = await supabase
        .from('products')
        .select(DISCOVERY_PRODUCT_PROJECTION)
        .eq('merchant_id', merchantId)
        .eq('status', 'active')
        .order('id', { ascending: true })
        .range(offset, offset + LEXICAL_PAGE_SIZE - 1);
      if (error) throw error;
      const rows = toMcpSearchProductRows(data);
      products.push(...rows);
      if (rows.length < LEXICAL_PAGE_SIZE) return { products, truncated: false };
    }
    const { data: next, error } = await supabase.from('products')
      .select('id')
      .eq('merchant_id', merchantId)
      .eq('status', 'active')
      .order('id', { ascending: true })
      .range(MAX_LEXICAL_CANDIDATES, MAX_LEXICAL_CANDIDATES);
    if (error) return { products, truncated: true };
    return { products, truncated: Array.isArray(next) && next.length > 0 };
  } catch {
    return { products, truncated: true };
  }
}

function reciprocalRankFusion(...sources: string[][]) {
  const scores = new Map<string, number>();
  for (const ids of sources) {
    for (const [rank, id] of ids.entries()) {
      scores.set(id, (scores.get(id) ?? 0) + 1 / (60 + rank + 1));
    }
  }
  return [...scores].sort(([idA, scoreA], [idB, scoreB]) =>
    scoreB - scoreA || idA.localeCompare(idB)
  ).map(([id]) => id);
}

export async function loadStructuredDiscoveryCandidates({
  query,
  merchantId,
  supabase,
  semanticSearch,
}: LoadStructuredDiscoveryCandidatesInput): Promise<{
  products: McpSearchProductRow[];
  truncated: boolean;
  semanticUnavailable: boolean;
}> {
  if (!query) {
    const result = await loadBrowseRows(merchantId, supabase);
    return { products: result.products, truncated: result.truncated, semanticUnavailable: false };
  }

  const lexicalPromise = loadLexicalIds(query, merchantId, supabase);
  const semanticPromise = semanticSearch
    ? loadSemanticIds(query, semanticSearch).then(
      (value) => ({ value, unavailable: value.probeFailed }),
      () => ({ value: { ids: [], truncated: true }, unavailable: true })
    )
    : Promise.resolve({ value: { ids: [], truncated: false }, unavailable: false });
  const [lexical, semantic, facts] = await Promise.all([
    lexicalPromise, semanticPromise, loadDiscoveryFactCandidates(query, merchantId, supabase),
  ]);
  const rankedIds = reciprocalRankFusion(lexical.ids, semantic.value.ids, facts.ids);
  const products: McpSearchProductRow[] = [];

  let hydrationFailed = false;
  for (let offset = 0; offset < rankedIds.length; offset += LEXICAL_PAGE_SIZE) {
    const batch = rankedIds.slice(offset, offset + LEXICAL_PAGE_SIZE);
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

  return {
    products,
    truncated: lexical.truncated || semantic.value.truncated || facts.truncated || hydrationFailed,
    semanticUnavailable: semantic.unavailable,
  };
}
