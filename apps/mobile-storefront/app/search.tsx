import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { Keyboard } from 'react-native';
import SearchScreenView from '@/components/search/SearchScreenView';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { MIN_SEARCH_QUERY_LENGTH } from '@/constants/search';
import { useCategories, useProductBrands, useProducts } from '@/hooks';
import { useNetworkState } from '@/hooks/use-network-state';
import { useSearchStorage } from '@/hooks/use-search-storage';
import { resolveSelectedCategoryId } from '@/lib/product-filter-options';
import type { Product } from '@/types/product';

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
  // Shared history state: writes here propagate to the still-mounted home
  // dropdown and overlay through the hook's subscription, with one write.
  const { recentSearches, saveSearch: saveToHistory } = useSearchStorage();
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

  // Applies a newly arrived route query to an already-mounted screen and
  // records each submitted route query in history exactly once. A transition
  // to a missing or invalid route param clears the route-owned search state
  // so stale results never linger on a parameterless route. In-screen edits
  // never change the route param, so typing after navigation is safe.
  const appliedRouteQueryRef = useRef<string | null>(null);
  const applyRouteQuery = useEffectEvent((nextQuery: string) => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    setQuery(nextQuery);
    setDebouncedQuery(nextQuery);
    saveToHistory(nextQuery);
  });
  const clearRouteQuery = useEffectEvent(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    setQuery('');
    setDebouncedQuery('');
  });
  useEffect(() => {
    const nextRouteQuery = parseRouteSearchQuery(routeQueryParam);
    if (nextRouteQuery) {
      if (appliedRouteQueryRef.current !== nextRouteQuery) {
        appliedRouteQueryRef.current = nextRouteQuery;
        applyRouteQuery(nextRouteQuery);
      }
      return;
    }
    if (appliedRouteQueryRef.current !== null) {
      appliedRouteQueryRef.current = null;
      clearRouteQuery();
    }
  }, [routeQueryParam]);

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
  const handleEndReached = () => {
    if (hasSearchQuery && hasMore && !isLoading && !isLoadingMore) {
      loadMore();
    }
  };

  const handleRetry = () => {
    void refetchProducts();
  };
  // A failed next page retries that offset via loadMore: refetch only
  // replays already-loaded pages, so routing the footer through refetch
  // would clear the error without appending the missing page.
  const handleRetryNextPage = () => {
    loadMore();
  };
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
        onRetryNextPage={handleRetryNextPage}
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
