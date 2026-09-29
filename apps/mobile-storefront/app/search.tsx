import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { Keyboard } from 'react-native';
import SearchScreenView from '@/components/search/SearchScreenView';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import {
  MAX_SEARCH_QUERY_LENGTH,
  MIN_SEARCH_QUERY_LENGTH,
} from '@/constants/search';
import { useCategories, useProductBrands, useProducts } from '@/hooks';
import { isSearchableQuery } from '@/hooks/is-searchable-query';
import { parseRouteSearchQuery } from '@/hooks/parse-route-search-query';
import { useNetworkState } from '@/hooks/use-network-state';
import { useSearchRouteQuerySync } from '@/hooks/use-search-route-query-sync';
import { useSearchStorage } from '@/hooks/use-search-storage';
import { resolveSelectedCategoryId } from '@/lib/product-filter-options';
import type { Product } from '@/types/product';

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
  // A committed query also has to survive product-search normalization:
  // punctuation-only input passes the length check but the fetch would
  // resolve it to zero matches. Gating here (rather than per submit
  // path) covers typed commits, debounced typing, and recent searches
  // uniformly: unsearchable input stays on the idle screen instead of
  // presenting a misleading no-results journey.
  const hasSearchQuery =
    debouncedQuery.length >= MIN_SEARCH_QUERY_LENGTH &&
    isSearchableQuery(debouncedQuery);
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

  // Route-owned query application: each submitted route query lands in
  // history exactly once, and starts from unrefined results — refinements
  // from a previous query must not narrow the newly arrived one. The sync
  // hook below drives these callbacks. (The display-only view mode is not
  // a refinement and is preserved.)
  const applyRouteQuery = useEffectEvent((nextQuery: string) => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    setQuery(nextQuery);
    setDebouncedQuery(nextQuery);
    setSelectedCategory('All');
    setMinPrice(0);
    setMaxPrice(0);
    setSelectedBrand('All');
    setSelectedCondition('All');
    setMinRating(0);
    saveToHistory(nextQuery);
  });
  const clearRouteQuery = useEffectEvent(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    setQuery('');
    setDebouncedQuery('');
    setSelectedCategory('All');
    setMinPrice(0);
    setMaxPrice(0);
    setSelectedBrand('All');
    setSelectedCondition('All');
    setMinRating(0);
  });
  useSearchRouteQuerySync({
    routeQueryParam,
    onApplyRouteQuery: applyRouteQuery,
    onClearRouteQuery: clearRouteQuery,
  });

  // Bound at acceptance so over-long pastes can never reach the debounced
  // auto-commit, history, or the search RPC from this screen either.
  const handleResultsQueryChange = (value: string) => {
    setQuery(value.slice(0, MAX_SEARCH_QUERY_LENGTH));
  };

  const commitSearchQuery = (value: string) => {
    const trimmedValue = value.trim().slice(0, MAX_SEARCH_QUERY_LENGTH);
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    setQuery(trimmedValue);
    setDebouncedQuery(trimmedValue);
    if (
      trimmedValue.length >= MIN_SEARCH_QUERY_LENGTH &&
      isSearchableQuery(trimmedValue)
    ) {
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
  // Pagination stays gated while ANY request error stands — refresh or
  // next-page. A failed background refetch retains products with a generic
  // error, and appending a page would succeed and clear that error while
  // the retained pages stay stale; and the error footer appearing can
  // itself emit an end event, so ungated next-page errors would fire
  // automatic retries without the shopper pressing anything. Recovery is
  // explicit: onRetry (refetch) for refresh failures, onRetryNextPage
  // (loadMore) for next-page failures. Transient blips never reach this
  // gate — TanStack already retries them internally (retry: 2) — so a
  // standing error means recovery genuinely needs shopper intent.
  const hasProductsError = hasSearchQuery && productsError !== null;
  const handleEndReached = () => {
    if (
      hasSearchQuery &&
      hasMore &&
      !isLoading &&
      !isLoadingMore &&
      !hasProductsError
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
        onQueryChange={handleResultsQueryChange}
        onRecentSearch={(search) => {
          const boundedSearch = search.slice(0, MAX_SEARCH_QUERY_LENGTH);
          setQuery(boundedSearch);
          saveToHistory(boundedSearch);
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
