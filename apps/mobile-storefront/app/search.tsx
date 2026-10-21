import {
  type RefinementParams,
  resetRefinementsForQuery,
} from '@baci/shared/lib';
import { router, Stack, useIsFocused, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Keyboard } from 'react-native';
import SearchScreenView from '@/components/search/SearchScreenView';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import {
  MAX_SEARCH_QUERY_LENGTH,
  MIN_SEARCH_QUERY_LENGTH,
} from '@/constants/search';
import { useCategories, useProducts } from '@/hooks';
import { isSearchableQuery } from '@/hooks/is-searchable-query';
import { CONSTANT_MERCHANT_ID } from '@/hooks/product-utils';
import { useMerchant } from '@/hooks/use-merchant';
import { useNetworkState } from '@/hooks/use-network-state';
import { useSearchFacetOptions } from '@/hooks/use-search-facet-options';
import { useSearchMinLengthHint } from '@/hooks/use-search-min-length-hint';
import { useSearchScreenQuery } from '@/hooks/use-search-screen-query';
import { useSearchStorage } from '@/hooks/use-search-storage';
import { normalizeProductConditionFilterValue } from '@/lib/product-filter-options';
import { buildSearchMatchRouteParams } from '@/lib/product-match-route-params';
import type { Product } from '@/types/product';

export default function SearchScreen() {
  const isFocused = useIsFocused();
  const colors = Colors[useColorScheme() ?? 'light'];
  const { isOnline } = useNetworkState();
  const routeParams = useLocalSearchParams<{
    q?: string | string[];
    focus?: string;
    brand?: string | string[];
    category?: string;
    condition?: string;
    minPrice?: string;
    maxPrice?: string;
    minRating?: string;
    processor?: string;
    sort?: string;
  }>();
  const {
    showSearchMinLengthHint,
    evaluateCommit,
    noteQueryChange,
    clearHint,
  } = useSearchMinLengthHint();
  // Shared history state: writes here propagate to the still-mounted home
  // dropdown and overlay through the hook's subscription, with one write.
  const { recentSearches, saveSearch: saveToHistory } = useSearchStorage();
  const {
    query,
    setQuery,
    debouncedQuery,
    hasSearchQuery,
    handleQueryChange: handleResultsQueryChange,
    commitSearchQuery,
    cancelDebounce,
    applyAssistance,
    refinements,
    commitRefinements,
    invalidFilters,
    isRestoring,
  } = useSearchScreenQuery({
    isFocused,
    routeQueryParam: routeParams.q,
    routeParams: routeParams as RefinementParams,
    writeParams: (params) => router.setParams?.(params),
    evaluateCommit,
    noteQueryChange,
    clearHint,
    saveToHistory,
  });
  const minPrice = refinements.minPrice ?? 0;
  const maxPrice = refinements.maxPrice ?? 0;
  const minRating = refinements.minRating ?? 0;
  const selectedBrand = refinements.brands[0] ?? 'All';
  const selectedCondition = refinements.condition ?? 'All';
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  const { data: merchant } = useMerchant();
  const merchantId = merchant?.id || CONSTANT_MERCHANT_ID;
  const { data: categories = [] } = useCategories();
  const selectedCategory =
    categories.find((category) => category.id === refinements.categoryId)
      ?.name ?? 'All';
  const selectedCategoryId = refinements.categoryId;
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
    refinements,
    enabled: hasSearchQuery && !invalidFilters && !isRestoring,
  });
  const availableFacets = useSearchFacetOptions(
    debouncedQuery,
    hasSearchQuery && !invalidFilters && !isRestoring,
    refinements.categoryId,
    merchantId
  );
  const brandNames = availableFacets.data?.brands ?? [];
  const facetError = availableFacets.error?.message ?? null;
  const retryFacets = availableFacets.refetch;

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

  const handleCategorySelect = (category: string) =>
    commitRefinements({
      ...refinements,
      categoryId: categories.find((item) => item.name === category)?.id,
    });
  const handleProductPress = (product: Product) => {
    cancelDebounce();
    setQuery(debouncedQuery);
    if (hasSearchQuery) {
      saveToHistory(debouncedQuery);
    }
    router.push({
      pathname: '/product/[slug]',
      params: {
        slug: product.slug,
        ...buildSearchMatchRouteParams(product.searchMatch),
      },
    });
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <SearchScreenView
        autoFocus={routeParams.focus === '1' && isFocused}
        onApplyAssistance={applyAssistance}
        refinements={refinements}
        onRefinementsChange={commitRefinements}
        invalidFilters={invalidFilters}
        filterCategories={availableFacets.data?.categories ?? []}
        availableConditions={availableFacets.data?.conditions ?? []}
        processors={availableFacets.data?.processors ?? []}
        facetError={facetError}
        onRetryFacets={() => void retryFacets?.()}
        onPrepareRefinements={() => {
          if (
            !isSearchableQuery(query.trim()) ||
            query.trim().length < MIN_SEARCH_QUERY_LENGTH
          )
            return null;
          const next = resetRefinementsForQuery(
            debouncedQuery,
            query,
            refinements
          );
          commitSearchQuery(query, false);
          return next;
        }}
        brandNames={brandNames}
        categories={categories}
        categoryNames={categoryNames}
        colors={colors}
        committedQuery={hasSearchQuery ? debouncedQuery : ''}
        hasMore={hasMore}
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
        onClearQuery={() => {
          setQuery('');
          clearHint();
        }}
        onEndReached={handleEndReached}
        onPriceChange={(minimum, maximum) =>
          commitRefinements({
            ...refinements,
            minPrice: minimum || undefined,
            maxPrice: maximum || undefined,
          })
        }
        onProductPress={handleProductPress}
        onQueryChange={handleResultsQueryChange}
        onRecentSearch={(search) => {
          const boundedSearch = search.slice(0, MAX_SEARCH_QUERY_LENGTH);
          setQuery(boundedSearch);
          // Clear-on-valid like typing, or valid results keep a stale warning.
          noteQueryChange(boundedSearch);
          saveToHistory(boundedSearch);
          Keyboard.dismiss();
        }}
        onRetry={handleRetry}
        onRetryNextPage={handleRetryNextPage}
        onSelectBrand={(brand) =>
          commitRefinements({
            ...refinements,
            brands: brand === 'All' ? [] : [brand],
          })
        }
        onSelectCondition={(condition) =>
          commitRefinements({
            ...refinements,
            condition: normalizeProductConditionFilterValue(
              condition
            ) as typeof refinements.condition,
          })
        }
        onSelectRating={(rating) =>
          commitRefinements({ ...refinements, minRating: rating || undefined })
        }
        onSubmitQuery={() => commitSearchQuery(query)}
        onViewModeChange={setViewMode}
        products={products}
        query={query}
        recentSearches={recentSearches}
        searchError={hasSearchQuery ? productsError : null}
        selectedBrand={selectedBrand}
        showMinLengthHint={showSearchMinLengthHint}
        selectedCategory={selectedCategory}
        selectedCondition={selectedCondition}
        totalCount={totalCount}
        viewMode={viewMode}
      />
    </>
  );
}
