import type { SupabaseClient } from '@supabase/supabase-js';
import { DISCOVERY_PRODUCT_PROJECTION } from './discovery-product-projection';
import { inferSmartphoneCategory } from './infer-smartphone-category';
import { hydrateSearchProductAvailability } from './search-product-availability';
import { loadMcpSearchProducts } from './search-products-query';
import {
  matchesMcpPostHydrationFilters,
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
  semanticSearch?: (query: string) => Promise<string[]>;
  supabase: SupabaseClient;
};

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
  const hydratedProducts: Awaited<ReturnType<typeof hydrateSearchProductAvailability>> = [];
  for (let offset = 0; offset < products.length; offset += 100) {
    hydratedProducts.push(...await hydrateSearchProductAvailability(
      products.slice(offset, offset + 100), supabase, merchantId, args.condition
    ));
  }
  if (semanticSearch && loaded.sanitizedQuery &&
    selectSearchProductsByPrice(hydratedProducts, args, limit).length < limit) {
    try {
      const lexicalIds = new Set(products.map((product) => product.id));
      const semanticIds = (await semanticSearch(loaded.sanitizedQuery))
        .filter((id) => !lexicalIds.has(id)).slice(0, 40);
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
          .filter((product) => product && matchesMcpPostHydrationFilters(product, {
            brand, category, condition,
          }));
        hydratedProducts.push(...await hydrateSearchProductAvailability(
          candidates, supabase, merchantId, args.condition
        ));
      }
    } catch {
      // Semantic discovery is optional. The catalog's lexical results remain usable.
      console.error('Semantic discovery unavailable; using catalog search only');
    }
  }
  if (args.sort === 'newest') {
    hydratedProducts.sort((a, b) =>
      (b.product.created_at ?? '').localeCompare(a.product.created_at ?? '') ||
      a.product.id.localeCompare(b.product.id)
    );
  }
  return {
    ...loaded,
    selectedProducts: selectSearchProductsByPrice(hydratedProducts, args, limit),
  };
}
