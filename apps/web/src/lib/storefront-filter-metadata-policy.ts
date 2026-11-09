import type { Metadata } from 'next';

/**
 * Standard robots policy for indexable public storefront pages.
 */
const STOREFRONT_FILTER_SEARCH_PARAMS: ReadonlyMap<string, string> = new Map([
  ['brand', 'brand'],
  ['brands', 'brand'],
  ['categories', 'category'],
  ['category', 'category'],
  ['color', 'color'],
  ['colors', 'color'],
  ['condition', 'condition'],
  ['displaySize', 'displaySize'],
  ['q', 'search'],
  ['query', 'search'],
  ['search', 'search'],
  ['displayType', 'displayType'],
  ['graphics', 'graphics'],
  ['graphicsHub', 'graphicsHub'],
  ['maxPrice', 'price'],
  ['minPrice', 'price'],
  ['order', 'sort'],
  ['ram', 'ram'],
  ['simType', 'simType'],
  ['sort', 'sort'],
  ['sortBy', 'sort'],
  ['storage', 'storage'],
] as const);

const STOREFRONT_CANONICAL_FILTER_QUERY_KEYS = [
  ['brand', ['brand', 'brands']],
  ['color', ['color', 'colors']],
  ['condition', ['condition']],
  ['displaySize', ['displaySize']],
  ['displayType', ['displayType']],
  ['graphics', ['graphics']],
  ['price', ['minPrice', 'maxPrice']],
  ['ram', ['ram']],
  ['search', ['search', 'q', 'query']],
  ['simType', ['simType']],
  ['storage', ['storage']],
] as const satisfies readonly [string, readonly string[]][];

const NON_INDEXABLE_CANONICAL_FILTER_KEYS = new Set([
  'category',
  'graphicsHub',
  'sort',
]);

export type StorefrontRobotsSearchParams = Record<
  string,
  string | string[] | undefined
>;

export interface StorefrontFilterMetadataOptions {
  filtersAffectResults?: boolean;
}

function hasSearchParamValue(value: string | string[] | undefined): boolean {
  if (Array.isArray(value)) {
    return value.some((entry) => entry.trim() !== '');
  }

  return typeof value === 'string' && value.trim() !== '';
}

function getActiveStorefrontFilterKeys(
  searchParams?: StorefrontRobotsSearchParams
): Set<string> {
  const activeFilters = new Set<string>();

  if (!searchParams) {
    return activeFilters;
  }

  for (const [key, value] of Object.entries(searchParams)) {
    const canonicalFilterKey = STOREFRONT_FILTER_SEARCH_PARAMS.get(key);

    if (canonicalFilterKey && hasSearchParamValue(value)) {
      activeFilters.add(canonicalFilterKey);
    }
  }

  return activeFilters;
}

function getCanonicalStorefrontFilterQueryKey(
  queryKey: string,
  activeFilterKey: string
): string {
  if (activeFilterKey !== 'search') {
    return queryKey;
  }

  return STOREFRONT_FILTER_SEARCH_PARAMS.get(queryKey) ?? queryKey;
}

export function hasFilterableQueryParams(
  searchParams?: StorefrontRobotsSearchParams
): boolean {
  return getActiveStorefrontFilterKeys(searchParams).size > 0;
}

export function getCanonicalStorefrontFilterSearchParams(
  searchParams?: StorefrontRobotsSearchParams,
  options: StorefrontFilterMetadataOptions = {}
): URLSearchParams {
  const canonicalParams = new URLSearchParams();
  const activeFilterKeys = getActiveStorefrontFilterKeys(searchParams);

  if (
    !searchParams ||
    !options.filtersAffectResults ||
    activeFilterKeys.size !== 1
  ) {
    return canonicalParams;
  }

  const [activeFilterKey] = activeFilterKeys;
  if (!activeFilterKey) {
    return canonicalParams;
  }

  const filterQueryKeys = STOREFRONT_CANONICAL_FILTER_QUERY_KEYS.find(
    ([canonicalFilterKey]) => canonicalFilterKey === activeFilterKey
  )?.[1];

  if (!filterQueryKeys) {
    return canonicalParams;
  }

  for (const queryKey of filterQueryKeys) {
    const value = searchParams[queryKey];

    if (Array.isArray(value)) {
      for (const entry of value) {
        const trimmedEntry = entry.trim();
        if (trimmedEntry) {
          canonicalParams.append(
            getCanonicalStorefrontFilterQueryKey(queryKey, activeFilterKey),
            trimmedEntry
          );
        }
      }
      continue;
    }

    const trimmedValue = value?.trim();
    if (trimmedValue) {
      canonicalParams.append(
        getCanonicalStorefrontFilterQueryKey(queryKey, activeFilterKey),
        trimmedValue
      );
    }
  }

  return canonicalParams;
}

export function getIndexableRobotsMetadata(
  searchParams?: StorefrontRobotsSearchParams,
  options: StorefrontFilterMetadataOptions = {}
): Metadata['robots'] {
  const activeFilterKeys = getActiveStorefrontFilterKeys(searchParams);
  const activeFilterCount = activeFilterKeys.size;
  const hasNonIndexableParam = Array.from(activeFilterKeys).some((key) =>
    NON_INDEXABLE_CANONICAL_FILTER_KEYS.has(key)
  );

  const isIndexable =
    !hasNonIndexableParam &&
    (activeFilterCount === 0 ||
      (options.filtersAffectResults === true && activeFilterCount <= 1));

  return {
    index: isIndexable,
    follow: true,
    googleBot: {
      index: isIndexable,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
      'max-video-preview': -1,
    },
    'max-image-preview': 'large',
    'max-snippet': -1,
    'max-video-preview': -1,
  };
}
