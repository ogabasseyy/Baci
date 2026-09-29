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

/**
 * Compares raw route params by value (arrays element-wise). A repeated
 * param and its joined string form are NOT equal: one is ambiguous and
 * rejected, the other is a searchable query.
 */
function isSameRouteParam(
  a: string | string[] | undefined,
  b: string | string[] | undefined
): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((value, index) => value === b[index])
    );
  }
  return a === b;
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
  // to a missing or invalid route param clears the search state so stale
  // results never linger — keyed off the raw param transition, not just the
  // last applied query, so locally entered searches also clear when an
  // invalid param arrives on a parameterless-opened screen. In-screen edits
  // never change the route param, so typing after navigation is safe.
  const appliedRouteQueryRef = useRef<string | null>(null);
  // The raw param behind the last effect run. Initialized to the mount
  // value so the first run never counts as a transition.
  const prevRouteQueryParamRef = useRef<string | string[] | undefined>(
    routeQueryParam
  );
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
    const rawParamChanged = !isSameRouteParam(
      prevRouteQueryParamRef.current,
      routeQueryParam
    );
    prevRouteQueryParamRef.current = routeQueryParam;
    if (nextRouteQuery) {
      if (appliedRouteQueryRef.current !== nextRouteQuery) {
        appliedRouteQueryRef.current = nextRouteQuery;
        applyRouteQuery(nextRouteQuery);
      }
      return;
    }
    // Missing or invalid route query: clear on a genuine raw transition
    // (or a previously applied route query) so a locally entered search
    // never lingers after a deep-link update arrives on a screen that was
    // opened parameterless. The mount run is never a transition.
    if (rawParamChanged || appliedRouteQueryRef.current !== null) {
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
    isFetching: productsFetching,
    isLoading,
    isLoadingMore,
    isNextPageError: productsNextPageError,
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
  // A failed background refetch retains products with a generic error.
  // Appending a page would succeed and clear that error while the retained
  // pages stay stale — and the error footer changing the layout can itself
  // emit an end event — so pagination stays gated until refetch recovers.
  const hasRefreshError =
    hasSearchQuery && productsError !== null && !productsNextPageError;
  const handleEndReached = () => {
    if (
      hasSearchQuery &&
      hasMore &&
      !isLoading &&
      !isLoadingMore &&
      !hasRefreshError
    ) {
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
        isNextPageError={hasSearchQuery && productsNextPageError}
        isOnline={isOnline}
        // A retry keeps the error status while fetching, so isLoading stays
        // false: forward the fetching flag so the error state can present
        // a pending retry instead of a stale enabled button.
        isRetrying={hasSearchQuery && productsFetching}
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
