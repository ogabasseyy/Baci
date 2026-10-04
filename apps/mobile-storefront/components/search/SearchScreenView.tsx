import type {
  SearchAssistanceProposal,
  SearchRefinements,
} from '@baci/shared/lib';
import { useState } from 'react';
import { useWindowDimensions } from 'react-native';
import {
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { FilterBar } from '@/components/storefront/FilterBar';
import type Colors from '@/constants/Colors';
import { useKeyboard } from '@/hooks/use-keyboard';
import { useSearchToolbarVisibility } from '@/hooks/use-search-toolbar-visibility';
import type { Category, Product } from '@/types/product';
import { SearchRefinementControls } from './refinements/SearchRefinementControls';
import SearchAssistanceSuggestions from './SearchAssistanceSuggestions';
import { SearchComparisonSession } from './SearchComparisonSession';
import SearchResultsHeader from './SearchResultsHeader';
import SearchScreenBody from './SearchScreenBody';
import { SearchScreenTopBar } from './SearchScreenTopBar';
import { SearchToolbarReveal } from './SearchToolbarReveal';
import styles from './search-screen.styles';

interface SearchScreenViewProps {
  processors?: string[];
  filterCategories?: { id: string; name: string }[];
  availableConditions?: NonNullable<SearchRefinements['condition']>[];
  autoFocus?: boolean;
  onApplyAssistance?: (proposal: SearchAssistanceProposal) => void;
  refinements?: SearchRefinements;
  onRefinementsChange?: (next: SearchRefinements) => void;
  onPrepareRefinements?: () => SearchRefinements | null;
  invalidFilters?: boolean;
  facetError?: string | null;
  onRetryFacets?: () => void;

  brandNames: string[];
  categories: Category[];
  categoryNames: string[];
  colors: (typeof Colors)['light'];
  /** The committed (debounced) query behind the current result set. */
  committedQuery: string;
  hasSearchQuery: boolean;
  /** True while additional pages are being appended. */
  isLoadingMore: boolean;
  isLoading: boolean;
  /** True when the current error came from a next-page fetch (not a refetch). */
  isNextPageError: boolean;
  isOnline: boolean;
  /** True while an initial-search retry request is in flight. */
  isRetrying: boolean;
  maxPrice: number;
  minPrice: number;
  minRating: number;
  onBack: () => void;
  onCategoryPress: (slug: string) => void;
  onCategorySelect: (category: string) => void;
  onClearQuery: () => void;
  onEndReached: () => void;
  onPriceChange: (min: number, max: number) => void;
  onProductPress: (product: Product) => void;
  onQueryChange: (query: string) => void;
  onRecentSearch: (query: string) => void;
  onRetry: () => void;
  /** Retries a failed next-page fetch without refetching loaded pages. */
  onRetryNextPage: () => void;
  onSelectBrand: (brand: string) => void;
  onSelectCondition: (condition: string) => void;
  onSelectRating: (rating: number) => void;
  onSubmitQuery: () => void;
  onViewModeChange: (mode: 'grid' | 'list') => void;
  products: Product[];
  query: string;
  recentSearches: string[];
  /** Non-null when the committed search failed to load. */
  searchError: string | null;
  selectedBrand: string;
  showMinLengthHint?: boolean;
  selectedCategory: string;
  selectedCondition: string;
  /** Total matches reported by the search backend. */
  totalCount: number;
  viewMode: 'grid' | 'list';
}

export default function SearchScreenView({
  processors,
  filterCategories,
  availableConditions,
  autoFocus,
  onApplyAssistance,
  refinements,
  onRefinementsChange,
  onPrepareRefinements,
  invalidFilters,
  facetError,
  onRetryFacets,
  brandNames,
  categories,
  categoryNames,
  colors,
  committedQuery,
  hasSearchQuery,
  isLoading,
  isLoadingMore,
  isNextPageError,
  isOnline,
  isRetrying,
  maxPrice,
  minPrice,
  minRating,
  onBack,
  onCategoryPress,
  onCategorySelect,
  onClearQuery,
  onEndReached,
  onPriceChange,
  onProductPress,
  onQueryChange,
  onRecentSearch,
  onRetry,
  onRetryNextPage,
  onSelectBrand,
  onSelectCondition,
  onSelectRating,
  onSubmitQuery,
  onViewModeChange,
  products,
  query,
  recentSearches,
  searchError,
  selectedBrand,
  selectedCategory,
  selectedCondition,
  showMinLengthHint = false,
  totalCount,
  viewMode,
}: SearchScreenViewProps) {
  const { height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { isKeyboardVisible, keyboardHeight, keyboardTop } = useKeyboard();
  const [viewportHeight, setViewportHeight] = useState(windowHeight);
  const [isRefinementOpen, setIsRefinementOpen] = useState(false);
  const [bottomSpace, setBottomSpace] = useState(100);
  const resultsKey = JSON.stringify([
    committedQuery,
    selectedBrand,
    selectedCategory,
    selectedCondition,
    minPrice,
    maxPrice,
    minRating,
    refinements,
  ]);
  const toolbar = useSearchToolbarVisibility(
    resultsKey,
    isRefinementOpen ||
      isKeyboardVisible ||
      isLoading ||
      !hasSearchQuery ||
      products.length === 0 ||
      !!searchError ||
      !!invalidFilters
  );

  return (
    <SearchComparisonSession scope={committedQuery}>
      <SafeAreaView
        style={[styles.container, { backgroundColor: colors.background }]}
        edges={['top']}
        onLayout={(event) => {
          if (!isKeyboardVisible)
            setViewportHeight(event.nativeEvent.layout.height);
        }}
      >
        <SearchScreenTopBar
          colors={colors}
          onBack={onBack}
          showComparison={hasSearchQuery && products.length > 0}
        />
        <SearchResultsHeader
          suggestions={
            isKeyboardVisible &&
            !isLoading &&
            !searchError &&
            onApplyAssistance ? (
              <SearchAssistanceSuggestions
                query={query}
                resultQuery={committedQuery}
                products={products.map((product) => ({
                  price: product.price,
                  condition:
                    product.searchMatch?.condition ?? product.condition,
                }))}
                colors={colors}
                onApply={onApplyAssistance}
              />
            ) : null
          }
          onBottomSpaceChange={setBottomSpace}
          showBackButton={false}
          autoFocus={autoFocus}
          availableHeight={
            isKeyboardVisible && keyboardTop != null
              ? keyboardTop + keyboardHeight
              : viewportHeight
          }
          colors={colors}
          onBack={onBack}
          onClearQuery={onClearQuery}
          onQueryChange={onQueryChange}
          onSubmitQuery={onSubmitQuery}
          query={query}
          showMinLengthHint={showMinLengthHint}
        />
        <SearchToolbarReveal visible={toolbar.visible}>
          {hasSearchQuery &&
            (refinements && onRefinementsChange ? (
              <SearchRefinementControls
                onPanelOpenChange={setIsRefinementOpen}
                criteria={refinements}
                onCommit={onRefinementsChange}
                brands={brandNames}
                categories={filterCategories ?? categories}
                conditions={availableConditions}
                processors={processors}
                colors={colors}
                invalidFilters={invalidFilters}
                facetError={facetError}
                onRetryFacets={onRetryFacets}
                onPrepare={onPrepareRefinements}
              />
            ) : (
              <FilterBar
                categories={categoryNames}
                selectedCategory={selectedCategory}
                onSelectCategory={onCategorySelect}
                minPrice={minPrice}
                maxPrice={maxPrice}
                onPriceChange={onPriceChange}
                brands={brandNames}
                onBrandFilterVisible={() => undefined}
                selectedBrand={selectedBrand}
                onSelectBrand={onSelectBrand}
                selectedCondition={selectedCondition}
                onSelectCondition={onSelectCondition}
                minRating={minRating}
                onSelectRating={onSelectRating}
                viewMode={viewMode}
                onViewModeChange={onViewModeChange}
              />
            ))}
        </SearchToolbarReveal>
        <SearchScreenBody
          bottomSpace={bottomSpace}
          categories={categories}
          colors={colors}
          committedQuery={committedQuery}
          hasSearchQuery={hasSearchQuery}
          insetsBottom={insets.bottom}
          invalidFilters={invalidFilters}
          isKeyboardVisible={isKeyboardVisible}
          isLoading={isLoading}
          isLoadingMore={isLoadingMore}
          isNextPageError={isNextPageError}
          isOnline={isOnline}
          isRetrying={isRetrying}
          keyboardHeight={keyboardHeight}
          onCategoryPress={onCategoryPress}
          onEndReached={onEndReached}
          onProductPress={onProductPress}
          onRecentSearch={onRecentSearch}
          onRetry={onRetry}
          onRetryNextPage={onRetryNextPage}
          onScroll={toolbar.onScroll}
          products={products}
          recentSearches={recentSearches}
          refinements={refinements}
          resultsKey={resultsKey}
          searchError={searchError}
          totalCount={totalCount}
        />
      </SafeAreaView>
    </SearchComparisonSession>
  );
}
