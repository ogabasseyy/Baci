import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard } from 'react-native';
import SearchScreenView from '@/components/search/SearchScreenView';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { useCategories, useProductBrands, useProducts } from '@/hooks';
import { useNetworkState } from '@/hooks/use-network-state';
import { resolveSelectedCategoryId } from '@/lib/product-filter-options';
import { syncStorage as storage } from '@/lib/storage';
import type { Product } from '@/types/product';

const SEARCH_HISTORY_KEY = 'search_history';
const MAX_SEARCH_HISTORY = 10;
const MIN_SEARCH_QUERY_LENGTH = 2;

/**
 * Validates the Expo Router `q` parameter before use. Repeated parameters
 * arrive as arrays and are ambiguous, so only a single string of at least
 * the search threshold is accepted.
 */
function parseRouteSearchQuery(
  param: string | string[] | undefined
): string | null {
  if (typeof param !== 'string') {
    return null;
  }

  const trimmed = param.trim();
  return trimmed.length >= MIN_SEARCH_QUERY_LENGTH ? trimmed : null;
}
const DEFAULT_SEARCHES = [
  'iPhone 15 Pro',
  'Samsung Galaxy S24',
  'AirPods Pro',
  'MacBook Air',
  'Apple Watch',
];

function dedupeRecentSearches(searches: string[]) {
  const seen = new Set<string>();

  return searches.filter((search) => {
    const normalizedSearch = search.trim().toLowerCase();
    if (!normalizedSearch || seen.has(normalizedSearch)) {
      return false;
    }

    seen.add(normalizedSearch);
    return true;
  });
}

function loadInitialRecentSearches(): string[] {
  try {
    const saved = storage.getItem(SEARCH_HISTORY_KEY);
    if (!saved) return DEFAULT_SEARCHES;

    let parsed: unknown;
    try {
      parsed = JSON.parse(saved);
    } catch {
      return DEFAULT_SEARCHES;
    }

    if (
      Array.isArray(parsed) &&
      parsed.every((item): item is string => typeof item === 'string')
    ) {
      return dedupeRecentSearches(parsed);
    }
  } catch {
    // Retain defaults when device storage is unavailable.
  }

  return DEFAULT_SEARCHES;
}

export default function SearchScreen() {
  const colors = Colors[useColorScheme() ?? 'light'];
  const { isOnline } = useNetworkState();
  const { q: routeQueryParam } = useLocalSearchParams<{
    q?: string | string[];
  }>();
  const routeQuery = parseRouteSearchQuery(routeQueryParam);
  const [query, setQuery] = useState(routeQuery ?? '');
  const activeQuery = query.trim();
  const [debouncedQuery, setDebouncedQuery] = useState(routeQuery ?? '');
  const hasSearchQuery = debouncedQuery.length >= MIN_SEARCH_QUERY_LENGTH;
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [minPrice, setMinPrice] = useState(0);
  const [maxPrice, setMaxPrice] = useState(0);
  const [selectedBrand, setSelectedBrand] = useState('All');
  const [selectedCondition, setSelectedCondition] = useState('All');
  const [minRating, setMinRating] = useState(0);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [recentSearches, setRecentSearches] = useState<string[]>(
    loadInitialRecentSearches
  );
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    debounceTimerRef.current = setTimeout(() => {
      setDebouncedQuery(activeQuery);
      debounceTimerRef.current = null;
    }, 250);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, [activeQuery]);

  const saveToHistory = useCallback((searchTerm: string) => {
    if (!searchTerm.trim() || searchTerm.length < MIN_SEARCH_QUERY_LENGTH)
      return;

    setRecentSearches((previousSearches) => {
      const filtered = previousSearches.filter(
        (search) => search.toLowerCase() !== searchTerm.toLowerCase()
      );
      const updated = [searchTerm, ...filtered].slice(0, MAX_SEARCH_HISTORY);

      try {
        storage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(updated));
      } catch {
        // Search remains usable if persistence fails.
      }

      return updated;
    });
  }, []);

  // Applies a newly arrived route query to an already-mounted screen and
  // records each submitted route query in history exactly once. In-screen
  // edits never retrigger this effect, so typing after navigation is safe.
  const appliedRouteQueryRef = useRef<string | null>(null);
  useEffect(() => {
    if (routeQuery && appliedRouteQueryRef.current !== routeQuery) {
      appliedRouteQueryRef.current = routeQuery;
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      setQuery(routeQuery);
      setDebouncedQuery(routeQuery);
      saveToHistory(routeQuery);
    }
  }, [routeQuery, saveToHistory]);

  const commitSearchQuery = (value: string) => {
    const trimmedValue = value.trim();
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    setQuery(trimmedValue);
    setDebouncedQuery(trimmedValue);
    if (trimmedValue.length >= MIN_SEARCH_QUERY_LENGTH) {
      saveToHistory(trimmedValue);
    }
    Keyboard.dismiss();
  };

  const { data: categories = [] } = useCategories();
  const selectedCategoryId = resolveSelectedCategoryId(
    selectedCategory,
    categories
  );
  // The product query stays disabled until a valid search is committed so the
  // idle recent-search screen never fetches an unseen product page.
  const {
    error: productsError,
    hasMore,
    isLoading,
    isLoadingMore,
    loadMore,
    products,
    refetch: refetchProducts,
    total: totalCount,
  } = useProducts({
    search: hasSearchQuery ? debouncedQuery : undefined,
    limit: 20,
    category: selectedCategoryId,
    brand: selectedBrand !== 'All' ? selectedBrand : undefined,
    condition: selectedCondition !== 'All' ? selectedCondition : undefined,
    minPrice: minPrice > 0 ? minPrice : undefined,
    maxPrice: maxPrice > 0 ? maxPrice : undefined,
    minRating: minRating > 0 ? minRating : undefined,
    enabled: hasSearchQuery,
  });
  const { brands: brandNames } = useProductBrands({
    search: hasSearchQuery ? debouncedQuery : undefined,
    category: selectedCategoryId,
    condition: selectedCondition !== 'All' ? selectedCondition : undefined,
    minPrice: minPrice > 0 ? minPrice : undefined,
    maxPrice: maxPrice > 0 ? maxPrice : undefined,
    minRating: minRating > 0 ? minRating : undefined,
    enabled: hasSearchQuery,
  });

  // Guards the list end event against duplicate fetches; the hook queues a
  // bottom-reached signal that arrives mid-refetch instead of dropping it.
  const handleEndReached = useCallback(() => {
    if (hasSearchQuery && hasMore && !isLoading && !isLoadingMore) {
      loadMore();
    }
  }, [hasMore, hasSearchQuery, isLoading, isLoadingMore, loadMore]);

  const handleRetry = useCallback(() => {
    void refetchProducts();
  }, [refetchProducts]);
  const categoryNames = ['All', ...categories.map((category) => category.name)];

  // Adjust state inline during render (guarded, converges after one pass) so
  // an invalid brand filter never commits a stale frame.
  if (selectedBrand !== 'All' && !brandNames.includes(selectedBrand)) {
    setSelectedBrand('All');
  }

  const handleCategorySelect = (category: string) => {
    setSelectedCategory(category);
    setMinPrice(0);
    setMaxPrice(0);
    setSelectedBrand('All');
    setSelectedCondition('All');
    setMinRating(0);
  };

  const handleProductPress = (product: Product) => {
    if (hasSearchQuery) {
      saveToHistory(debouncedQuery);
    }
    router.push(`/product/${product.slug}`);
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <SearchScreenView
        brandNames={brandNames}
        categories={categories}
        categoryNames={categoryNames}
        colors={colors}
        committedQuery={hasSearchQuery ? debouncedQuery : ''}
        hasSearchQuery={hasSearchQuery}
        isLoading={isLoading}
        isLoadingMore={isLoadingMore}
        isOnline={isOnline}
        maxPrice={maxPrice}
        minPrice={minPrice}
        minRating={minRating}
        onBack={() => router.back()}
        onCategoryPress={(slug) =>
          router.push({ pathname: '/category/[slug]', params: { slug } })
        }
        onCategorySelect={handleCategorySelect}
        onClearQuery={() => setQuery('')}
        onEndReached={handleEndReached}
        onPriceChange={(minimum, maximum) => {
          setMinPrice(minimum);
          setMaxPrice(maximum);
        }}
        onProductPress={handleProductPress}
        onQueryChange={setQuery}
        onRecentSearch={(search) => {
          setQuery(search);
          saveToHistory(search);
          Keyboard.dismiss();
        }}
        onRetry={handleRetry}
        onSelectBrand={setSelectedBrand}
        onSelectCondition={setSelectedCondition}
        onSelectRating={setMinRating}
        onSubmitQuery={() => commitSearchQuery(query)}
        onViewModeChange={setViewMode}
        products={products}
        query={query}
        recentSearches={recentSearches}
        searchError={hasSearchQuery ? productsError : null}
        selectedBrand={selectedBrand}
        selectedCategory={selectedCategory}
        selectedCondition={selectedCondition}
        totalCount={totalCount}
        viewMode={viewMode}
      />
    </>
  );
}
