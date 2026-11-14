import { dedupeById } from '@baci/shared/lib';
import { useEffect, useState } from 'react';
import {
  filterProductsByClientCategory,
  resolveNormalizedCategoryId,
  resolveProductGridRenderFlags,
  resolveSelectedCategoryName,
  shouldRetryCategoriesOnProductRetry,
} from '@/components/storefront/product-grid.helpers';
import { useProductGridCategories } from '@/components/storefront/use-product-grid-categories';
import { useProductGridFilters } from '@/components/storefront/use-product-grid-filters';
import {
  PRODUCT_GRID_BACKFILL_FLOOR,
  PRODUCT_GRID_MAX_PRICE_LIMIT,
} from '@/constants/product-grid';
import {
  type Category,
  useCategories,
  useProductBrands,
  useProducts,
} from '@/hooks';
import {
  ALL_PRODUCT_FILTER_CATEGORY_SLUG,
  normalizeSelectedCategorySlug,
  resolveSelectedCategoryId,
} from '@/lib/product-filter-options';
import type { CardVariant } from '@/lib/templates';

interface UseHomeProductFeedOptions {
  /** False when the home has no primary ProductGrid — gates the product/brand queries. */
  enabled: boolean;
  /** Header CategoryRail selection threaded into the products query. */
  selectedCategoryId: string | null;
  /** The primary block's template card variant; combined with viewMode. */
  variant: CardVariant;
  /** Primary block page size (`block.props.limit ?? 12`). */
  limit: number;
  initialViewMode?: 'grid' | 'list';
}

/**
 * Hoists the data/filter/derivation logic of `ProductGrid` so a single
 * virtualized FlashList host (`HomeFeedList`) can own the home feed. Returns
 * the post-client-filter, deduped `feedProducts` (FlashList `data`), the full
 * `FilterBar` prop surface, and the render/retry flags — while keeping raw
 * fetched products internal for category derivation and render-flag counts.
 */
export function useHomeProductFeed({
  enabled,
  selectedCategoryId,
  variant,
  limit,
  initialViewMode,
}: UseHomeProductFeedOptions) {
  const {
    handleCategorySelect,
    handlePriceChange,
    maxPrice,
    minPrice,
    minRating,
    selectedBrand,
    selectedCategorySlug,
    selectedCondition,
    setMinRating,
    setSelectedBrand,
    setSelectedCondition,
    setViewMode,
    viewMode,
  } = useProductGridFilters(initialViewMode);
  const [brandOptionsRequested, setBrandOptionsRequested] = useState(false);

  const {
    data: categoriesData = [],
    isFetchedAfterMount: isCategoriesFetchedAfterMount,
    isFetching: isCategoriesFetching,
    isLoading: isCategoriesLoading,
    isError: isCategoriesError,
    refetch: refetchCategories,
  } = useCategories();
  const normalizedCategories: Category[] = categoriesData;

  const selectedCategoryIdFromFilter = resolveSelectedCategoryId(
    selectedCategorySlug,
    normalizedCategories
  );
  const normalizedCategoryId = resolveNormalizedCategoryId({
    selectedCategoryId,
    selectedCategoryIdFromFilter,
    selectedCategorySlug,
  });

  const activeMinPrice = minPrice > 0 ? minPrice : undefined;
  const activeMaxPrice =
    maxPrice < PRODUCT_GRID_MAX_PRICE_LIMIT ? maxPrice : undefined;
  const activeCondition =
    selectedCondition !== 'All' ? selectedCondition : undefined;
  const activeMinRating = minRating > 0 ? minRating : undefined;

  const {
    products: rawProducts,
    hasMore,
    isFetchedAfterMount,
    isLoading,
    isLoadingMore,
    isFetching,
    isError,
    loadMore,
    refetch,
  } = useProducts({
    limit,
    category: normalizedCategoryId,
    minPrice: activeMinPrice,
    maxPrice: activeMaxPrice,
    brand: selectedBrand !== 'All' ? selectedBrand : undefined,
    condition: activeCondition,
    minRating: activeMinRating,
    enabled,
  });

  const { categoryNames } = useProductGridCategories({
    normalizedCategories,
    products: rawProducts,
    isCategoriesLoading,
    isCategoriesFetching,
    isCategoriesFetchedAfterMount,
    isCategoriesError,
    isProductsLoading: isLoading,
    isProductsFetching: isFetching,
    isProductsFetchedAfterMount: isFetchedAfterMount,
  });
  const { matchedCategoryName, selectedCategoryName } =
    resolveSelectedCategoryName({
      categoryNames,
      normalizedCategories,
      selectedCategorySlug,
    });

  if (
    __DEV__ &&
    !matchedCategoryName &&
    selectedCategorySlug !== ALL_PRODUCT_FILTER_CATEGORY_SLUG
  ) {
    console.warn(
      `[useHomeProductFeed] selectedCategorySlug "${selectedCategorySlug}" does not map to any known category; chip UI will show "All" while product query remains filtered by the stale slug.`
    );
  }

  // Post-client-filter, deduped set is the FlashList `data`. Raw products stay
  // internal (above) for category derivation and the render-flag counts.
  const feedProducts = dedupeById(
    filterProductsByClientCategory({
      normalizedCategories,
      products: rawProducts,
      selectedCategorySlug,
    })
  );

  const shouldLoadBrandOptions =
    brandOptionsRequested || selectedBrand !== 'All';
  const { brands = [], isLoading: isBrandsLoading } = useProductBrands({
    category: normalizedCategoryId,
    enabled: enabled && shouldLoadBrandOptions,
    minPrice: activeMinPrice,
    maxPrice: activeMaxPrice,
    condition: activeCondition,
    minRating: activeMinRating,
  });

  const feedResetKey = JSON.stringify({
    category: normalizedCategoryId ?? null,
    displayLimit: limit,
    maxPrice,
    minPrice,
    minRating,
    selectedBrand,
    selectedCategorySlug,
    selectedCondition,
  });

  // Reset a selected brand that no longer exists in the (re-scoped) brand list,
  // otherwise the feed stays filtered by a zero-match brand → permanently empty.
  useEffect(() => {
    if (
      shouldLoadBrandOptions &&
      !isBrandsLoading &&
      selectedBrand !== 'All' &&
      !brands.includes(selectedBrand)
    ) {
      setSelectedBrand('All');
    }
  }, [
    brands,
    isBrandsLoading,
    selectedBrand,
    setSelectedBrand,
    shouldLoadBrandOptions,
  ]);

  // Client-side category filtering can thin a plentiful raw page below a
  // viewport; backfill until the floor is met or the catalog is exhausted.
  const feedCount = feedProducts.length;
  useEffect(() => {
    if (
      enabled &&
      hasMore &&
      !isFetching &&
      !isLoadingMore &&
      feedCount < PRODUCT_GRID_BACKFILL_FLOOR
    ) {
      loadMore();
    }
  }, [enabled, hasMore, isFetching, isLoadingMore, feedCount, loadMore]);

  const {
    isRetrying: isCategoriesRetrying,
    shouldShowFatalError,
    shouldShowInitialLoading,
  } = resolveProductGridRenderFlags({
    isCategoriesError,
    isCategoriesFetching,
    isError,
    isFetchedAfterMount,
    isLoading,
    productsLength: rawProducts.length,
    uniqueVisibleProductsLength: feedCount,
  });
  const isRetrying = isFetching || isCategoriesRetrying;

  const handleRetry = () => {
    void refetch();
    if (
      shouldRetryCategoriesOnProductRetry({
        isCategoriesError,
        isCategoriesFetchedAfterMount,
        isCategoriesFetching,
        isCategoriesLoading,
      })
    ) {
      void refetchCategories();
    }
  };

  const handleCategoryChipSelect = (categoryName: string) => {
    handleCategorySelect(
      normalizeSelectedCategorySlug(categoryName, normalizedCategories)
    );
  };

  const currentVariant: CardVariant = viewMode === 'list' ? 'list' : variant;

  const filterBarProps = {
    categories: categoryNames,
    selectedCategory: selectedCategoryName,
    onSelectCategory: handleCategoryChipSelect,
    minPrice,
    maxPrice,
    onPriceChange: handlePriceChange,
    brands,
    onBrandFilterVisible: () => setBrandOptionsRequested(true),
    selectedBrand,
    onSelectBrand: setSelectedBrand,
    selectedCondition,
    onSelectCondition: setSelectedCondition,
    minRating,
    onSelectRating: setMinRating,
    viewMode,
    onViewModeChange: setViewMode,
  };

  return {
    feedProducts,
    isLoading,
    isError,
    isFetching,
    isRetrying,
    hasMore,
    loadMore,
    isLoadingMore,
    currentVariant,
    filterBarProps,
    handleRetry,
    shouldShowInitialLoading,
    shouldShowFatalError,
    feedResetKey,
  };
}
