import { getPrimaryProductImage } from '@/lib/product-image';
import { isValidUuid, sanitizeSearchQuery } from '@/lib/sanitize-core';
import {
  InvalidMerchantIdError,
  type StorefrontSearchSupabase,
  searchStorefrontProducts,
} from '@/lib/storefront-search';
import { runBoundedAutocompleteRequest } from './storefront-search-autocomplete-request';

const AUTOCOMPLETE_PRODUCT_SELECT = 'id, name, category, price, images, slug';
const MAX_AUTOCOMPLETE_LIMIT = 100;
const AUTOCOMPLETE_CACHE_VERSION = 'v1';
const AUTOCOMPLETE_CACHE_TTL_MS = 5_000;
const MAX_AUTOCOMPLETE_CACHE_ENTRIES = 256;
const AUTOCOMPLETE_IN_FLIGHT_TIMEOUT_MS = 5_000;
const MAX_AUTOCOMPLETE_IN_FLIGHT_ENTRIES = 256;
export const AUTOCOMPLETE_SATURATED_CODE = 'autocomplete_saturated';

class AutocompleteSaturationError extends Error {
  readonly code = AUTOCOMPLETE_SATURATED_CODE;

  constructor() {
    super('Autocomplete request capacity is temporarily exhausted');
    this.name = 'AutocompleteSaturationError';
  }
}

interface AutocompleteProductRow {
  id: string;
  name: string;
  category: string | null;
  price: number | string | null;
  images: unknown;
  slug: string | null;
}

interface AutocompleteProductQuery
  extends PromiseLike<{
    data: AutocompleteProductRow[] | null;
    error: unknown;
  }> {
  in: (column: string, values: string[]) => AutocompleteProductQuery;
  eq: (column: string, value: string) => AutocompleteProductQuery;
}

interface AutocompleteProductTable {
  select: (columns: string) => AutocompleteProductQuery;
}

export interface AutocompleteSupabase extends StorefrontSearchSupabase {
  from: (table: string) => AutocompleteProductTable;
}

export interface AutocompleteProductSuggestion {
  id: string;
  name: string;
  category: string | null;
  price: number | string | null;
  image_small: string | null;
  slug: string | null;
  relevance: number;
}

export interface AutocompleteResponse {
  suggestions: AutocompleteProductSuggestion[];
  popularSearches: Array<{ search_query: string; search_count: number }>;
}

interface AutocompleteCacheEntry {
  expiresAt: number;
  response: AutocompleteResponse;
}

interface AbortableAutocompleteQuery<T> extends PromiseLike<T> {
  abortSignal?: (signal: AbortSignal) => AbortableAutocompleteQuery<T>;
  retry?: (enabled: boolean) => AbortableAutocompleteQuery<T>;
}

const autocompleteCache = new Map<string, AutocompleteCacheEntry>();
const autocompleteInFlight = new Map<string, Promise<AutocompleteResponse>>();

function getImageSmall(images: unknown): string | null {
  // Catalog images may be plain string URLs or `{ url, alt, order }` objects;
  // reuse the shared resolver so autocomplete thumbnails match the storefront.
  return getPrimaryProductImage(
    images as Array<string | { url?: string | null }> | null | undefined
  );
}

function normalizeAutocompleteQuery(query: string) {
  // Match search_products_v2's lower(trim(...)) query identity. Internal
  // whitespace can affect exact and fuzzy SKU ranking, so it must remain part
  // of the cache and in-flight key.
  return sanitizeSearchQuery(query).toLowerCase();
}

function getAutocompleteCacheKey({
  merchantId,
  normalizedQuery,
  limit,
}: {
  merchantId: string;
  normalizedQuery: string;
  limit: number;
}) {
  return `${AUTOCOMPLETE_CACHE_VERSION}:${merchantId}:${normalizedQuery}:${limit}`;
}

function getCachedAutocompleteResponse(cacheKey: string) {
  const entry = autocompleteCache.get(cacheKey);
  if (!entry) {
    return undefined;
  }

  if (entry.expiresAt <= Date.now()) {
    autocompleteCache.delete(cacheKey);
    return undefined;
  }

  // Re-inserting on a hit keeps the map in least-recently-used order.
  autocompleteCache.delete(cacheKey);
  autocompleteCache.set(cacheKey, entry);
  return entry.response;
}

function cacheAutocompleteResponse(
  cacheKey: string,
  response: AutocompleteResponse
) {
  autocompleteCache.delete(cacheKey);
  autocompleteCache.set(cacheKey, {
    expiresAt: Date.now() + AUTOCOMPLETE_CACHE_TTL_MS,
    response,
  });

  while (autocompleteCache.size > MAX_AUTOCOMPLETE_CACHE_ENTRIES) {
    const oldestCacheKey = autocompleteCache.keys().next().value;
    if (oldestCacheKey === undefined) {
      break;
    }
    autocompleteCache.delete(oldestCacheKey);
  }
}

function withAutocompleteAbortSignal<T>(
  query: PromiseLike<T>,
  signal: AbortSignal
): PromiseLike<T> {
  const abortableQuery = query as AbortableAutocompleteQuery<T>;
  if (typeof abortableQuery.abortSignal !== 'function') {
    return query;
  }

  const deadlineBoundQuery = abortableQuery.abortSignal(signal);
  return typeof deadlineBoundQuery.retry === 'function'
    ? deadlineBoundQuery.retry(false)
    : deadlineBoundQuery;
}

async function fetchStorefrontAutocompleteProducts({
  supabase,
  merchantId,
  query,
  limit,
  signal,
}: {
  supabase: AutocompleteSupabase;
  merchantId: string;
  query: string;
  limit: number;
  signal: AbortSignal;
}): Promise<AutocompleteResponse> {
  const ranked = await searchStorefrontProducts({
    supabase: {
      rpc: (fn, args) =>
        withAutocompleteAbortSignal(supabase.rpc(fn, args), signal),
    },
    merchantId,
    query,
    limit,
    includeDidYouMean: false,
  });

  if (ranked.productIds.length === 0) {
    return { suggestions: [], popularSearches: [] };
  }

  const productQuery = supabase
    .from('products')
    .select(AUTOCOMPLETE_PRODUCT_SELECT)
    .in('id', ranked.productIds)
    .eq('merchant_id', merchantId)
    .eq('status', 'active');
  const { data, error } = await withAutocompleteAbortSignal(
    productQuery,
    signal
  );

  if (error) {
    throw error;
  }

  const order = new Map(
    ranked.productIds.map((id, index) => [id, index] as const)
  );
  const suggestions = (data ?? [])
    .map((product) => ({
      id: product.id,
      name: product.name,
      category: product.category,
      price: product.price,
      image_small: getImageSmall(product.images),
      slug: product.slug,
      relevance: 1,
    }))
    .sort(
      (a, b) =>
        (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
        (order.get(b.id) ?? Number.MAX_SAFE_INTEGER)
    );

  return { suggestions, popularSearches: [] };
}

export async function getStorefrontAutocompleteProducts({
  supabase,
  merchantId,
  query,
  limit,
}: {
  supabase: AutocompleteSupabase;
  merchantId: string;
  query: string;
  limit: number;
}): Promise<AutocompleteResponse> {
  const sanitizedQuery = sanitizeSearchQuery(query);
  if (sanitizedQuery.length < 2) {
    return { suggestions: [], popularSearches: [] };
  }

  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_AUTOCOMPLETE_LIMIT) {
    throw new Error(`limit must be between 1 and ${MAX_AUTOCOMPLETE_LIMIT}`);
  }

  if (!isValidUuid(merchantId)) {
    throw new InvalidMerchantIdError();
  }

  const cacheKey = getAutocompleteCacheKey({
    merchantId,
    normalizedQuery: normalizeAutocompleteQuery(sanitizedQuery),
    limit,
  });
  const cachedResponse = getCachedAutocompleteResponse(cacheKey);
  if (cachedResponse) {
    return cachedResponse;
  }

  return await runBoundedAutocompleteRequest({
    cacheKey,
    createSaturationError: () => new AutocompleteSaturationError(),
    inFlight: autocompleteInFlight,
    maxEntries: MAX_AUTOCOMPLETE_IN_FLIGHT_ENTRIES,
    onSuccess: (response) => cacheAutocompleteResponse(cacheKey, response),
    operation: (signal) =>
      fetchStorefrontAutocompleteProducts({
        supabase,
        merchantId,
        query: sanitizedQuery,
        limit,
        signal,
      }),
    timeoutMs: AUTOCOMPLETE_IN_FLIGHT_TIMEOUT_MS,
  });
}
