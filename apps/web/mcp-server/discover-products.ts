import type { SupabaseClient } from '@supabase/supabase-js';
import { isBroadIntentDiscoveryWord } from './broad-intent-discovery-word';
import { DISCOVERY_PRODUCT_PROJECTION } from './discovery-product-projection';
import { inferSmartphoneCategory } from './infer-smartphone-category';
import { hydrateSearchProductAvailability } from './search-product-availability';
import { matchesHydratedDiscoveryIntent } from './matches-hydrated-discovery-intent';
import { productTypes } from './matches-discovery-product-intent-vocab';
import { loadMcpSearchProducts } from './search-products-query';
import { matchesSingleWordDiscoveryQuery } from './search-products-relevance';
import { singleWordDiscoveryTerm } from './single-word-discovery-term';
import {
  matchesMcpPostHydrationFilters,
  type McpSearchProductRow,
  toMcpSearchProductRows,
} from './search-products-query-helpers';
import { selectSearchProductsByPrice } from './select-search-products-by-price';

type DiscoveryArgs = {
  brand?: string;
  category?: string;
  condition?: string;
  limit?: number;
  max_price?: number;
  min_price?: number;
  query?: string;
  sort?: 'price_asc' | 'price_desc' | 'newest' | 'relevance';
};

type DiscoveryInput = {
  args: DiscoveryArgs;
  merchantId: string;
  sanitizeString: (input: string, maxLength?: number) => string;
  semanticSearch?: (query: string, offset: number) => Promise<string[]>;
  supabase: SupabaseClient;
};

function isBroadUseCaseQuery(query: string | undefined): boolean {
  const normalized = query?.normalize('NFKC').toLocaleLowerCase('en').match(/[a-z0-9]+/g)?.join(' ') ?? '';
  return /^(?:(?:something|anything|products?|items?|gadgets?|best|recommendations?)\s+)?(?:for|to help with)\s+[a-z ]+$/.test(normalized);
}

export async function discoverMcpProducts({
  args,
  merchantId,
  sanitizeString,
  semanticSearch,
  supabase,
}: DiscoveryInput) {
  const loaded = await loadMcpSearchProducts({ args, merchantId, sanitizeString, supabase });
  const { products, limit } = loaded;
  if (!loaded.priceScanComplete) {
    return { ...loaded, selectedProducts: [] as Awaited<ReturnType<typeof hydrateSearchProductAvailability>> };
  }
  const hydratedProducts: Awaited<ReturnType<typeof hydrateSearchProductAvailability>> = [...(loaded.hydratedProducts ?? [])];
  const hydratedIds = new Set(hydratedProducts.map((row) => row.product.id));
  const uncachedProducts = products.filter((product) => !hydratedIds.has(product.id));
  for (let offset = 0; offset < uncachedProducts.length; offset += 100) {
    hydratedProducts.push(...await hydrateSearchProductAvailability(
      uncachedProducts.slice(offset, offset + 100), supabase, merchantId, args.condition
    ));
  }
  const matchingProducts = hydratedProducts.filter((row) =>
    matchesHydratedDiscoveryIntent(row, loaded.sanitizedQuery));
  const explicitCatalogFilter = [args.category, args.brand, args.condition]
    .some((value) => Boolean(value && sanitizeString(value, 50).trim()));
  const ambiguousQuery = loaded.sanitizedQuery &&
    (singleWordDiscoveryTerm(loaded.sanitizedQuery) || isBroadUseCaseQuery(loaded.sanitizedQuery)) &&
    !explicitCatalogFilter &&
    !inferSmartphoneCategory(loaded.sanitizedQuery, args.category);
  // Single-word brand queries ("iPhone" with a Smartphones filter) enable
  // semantic search, but the intent predicate passes them through, so gate
  // semantic candidates on the whole-word check. Generic type words and
  // broad use-case words keep the category filter as their only gate.
  const semanticSingleTerm = singleWordDiscoveryTerm(loaded.sanitizedQuery);
  const needsSemanticSingleWordGuard = semanticSingleTerm !== undefined &&
    !productTypes.has(semanticSingleTerm) && !isBroadIntentDiscoveryWord(semanticSingleTerm);
  if (semanticSearch && loaded.sanitizedQuery && !ambiguousQuery &&
    selectSearchProductsByPrice(matchingProducts, args, limit).length < limit) {
    try {
      const seenIds = new Set(products.map((product) => product.id));
      const semanticProducts: typeof hydratedProducts = [];
      for (let offset = 0; offset < 200; offset += 40) {
        const pageIds = await semanticSearch(loaded.sanitizedQuery, offset);
        const semanticIds = pageIds.filter((id) => !seenIds.has(id));
        semanticIds.forEach((id) => seenIds.add(id));
        if (semanticIds.length > 0) {
          const { data, error } = await supabase.from('products')
            .select(DISCOVERY_PRODUCT_PROJECTION)
            .eq('merchant_id', merchantId)
            .eq('status', 'active')
            .in('id', semanticIds);
          if (error) throw error;
          const byId = new Map(toMcpSearchProductRows(data).map((product) => [product.id, product]));
          const category = args.category
            ? sanitizeString(args.category, 50)
            : inferSmartphoneCategory(loaded.sanitizedQuery, args.category);
          const brand = args.brand ? sanitizeString(args.brand, 50) : undefined;
          const condition = args.condition ? sanitizeString(args.condition, 50) : undefined;
          const candidates = semanticIds
            .map((id) => byId.get(id))
            .filter((product): product is McpSearchProductRow => product !== undefined && matchesMcpPostHydrationFilters(product, {
              brand, category, condition,
            }));
          semanticProducts.push(...(await hydrateSearchProductAvailability(
            candidates, supabase, merchantId, args.condition
          )).filter((row) => matchesHydratedDiscoveryIntent(row, loaded.sanitizedQuery) &&
            (!needsSemanticSingleWordGuard ||
              matchesSingleWordDiscoveryQuery(row.product, loaded.sanitizedQuery, undefined))));
        }
        if (pageIds.length < 40 ||
          (args.sort !== 'newest' && args.sort !== 'price_asc' && args.sort !== 'price_desc' &&
            selectSearchProductsByPrice([...matchingProducts, ...semanticProducts], args, limit).length >= limit)) break;
      }
      matchingProducts.push(...semanticProducts);
    } catch {
      // Semantic discovery is optional. The catalog's lexical results remain usable.
      console.error('Semantic discovery unavailable; using catalog search only');
    }
  }
  if (args.sort === 'newest') {
    matchingProducts.sort((a, b) =>
      (b.product.created_at ?? '').localeCompare(a.product.created_at ?? '') ||
      a.product.id.localeCompare(b.product.id)
    );
  }
  return {
    ...loaded,
    selectedProducts: selectSearchProductsByPrice(matchingProducts, args, limit),
  };
}
