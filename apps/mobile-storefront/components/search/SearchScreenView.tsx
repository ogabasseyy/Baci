import type {
  SearchAssistanceProposal,
  SearchRefinements,
} from '@baci/shared/lib';
import Ionicons, {
  type IoniconsIconName,
} from '@react-native-vector-icons/ionicons';
import { useState } from 'react';
import { Pressable, Text, useWindowDimensions, View } from 'react-native';
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
import SearchAssistance from './SearchAssistance';
import { SearchShoppingActions } from './SearchComparisonControls';
import { SearchComparisonSession } from './SearchComparisonSession';
import SearchLoadingCards from './SearchLoadingCards';
import SearchResultsEmptyState from './SearchResultsEmptyState';
import SearchResultsErrorState from './SearchResultsErrorState';
import SearchResultsHeader from './SearchResultsHeader';
import SearchResultsList from './SearchResultsList';
import { SearchToolbarReveal } from './SearchToolbarReveal';
import styles from './search-screen.styles';

const CATEGORY_ICONS: Record<string, IoniconsIconName> = {
  phones: 'phone-portrait-outline',
  gaming: 'game-controller-outline',
  accessories: 'headset-outline',
  laptops: 'laptop-outline',
  audio: 'musical-notes-outline',
  tablets: 'tablet-portrait-outline',
  smartwatches: 'watch-outline',
};

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
  const renderResults = () => {
    if (invalidFilters)
      return (
        <View style={styles.loadingContainer}>
          <Text accessibilityRole="alert" style={{ color: colors.text }}>
            Invalid filters. Edit or clear filters to continue.
          </Text>
        </View>
      );
    if (!isOnline) {
      return (
        <View style={styles.emptyContainer}>
          <Ionicons
            name="cloud-offline-outline"
            size={64}
            color={colors.textSecondary}
          />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>
            You're offline
          </Text>
          <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
            Connect to the internet to search products
          </Text>
        </View>
      );
    }

    if (isLoading) return <SearchLoadingCards colors={colors} />;

    // A failed search is never reported as "no results": it keeps the retry
    // path and the query input visible instead. When earlier pages already
    // loaded, the list stays visible and the failure surfaces as a footer.
    if (searchError && products.length === 0) {
      return (
        <SearchResultsErrorState
          colors={colors}
          committedQuery={committedQuery}
          isRetrying={isRetrying}
          onCategoryPress={onCategoryPress}
          onRetry={onRetry}
        />
      );
    }

    if (products.length === 0) {
      return (
        <SearchResultsEmptyState
          categories={categories}
          colors={colors}
          committedQuery={committedQuery}
          onCategoryPress={onCategoryPress}
        />
      );
    }

    // Result-set identity: remounts the list whenever the committed
    // query or any refinement changes. Without this, a cached query B
    // renders in the same FlashList instance (isLoading stays false) and
    // inherits A's scroll offset — landing the shopper mid-list, where a
    // retained near-end position can immediately fire onEndReached and
    // load page two. Returning from a product keeps the identity (and
    // the scroll position) because neither side changes.

    return (
      <SearchResultsList
        bottomSpace={
          isKeyboardVisible
            ? keyboardHeight + 100
            : Math.max(100 + insets.bottom, bottomSpace)
        }
        colors={colors}
        committedQuery={committedQuery}
        isLoadingMore={isLoadingMore}
        isNextPageError={isNextPageError}
        isRetrying={isRetrying}
        listError={searchError}
        onEndReached={onEndReached}
        onProductPress={onProductPress}
        onRetry={onRetry}
        onRetryNextPage={onRetryNextPage}
        products={products}
        resultsKey={resultsKey}
        totalCount={totalCount}
        onScroll={toolbar.onScroll}
      />
    );
  };

  const renderSuggestions = () => (
    <View style={styles.suggestionsContainer}>
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>
          Recent Searches
        </Text>
        <View style={styles.recentList}>
          {recentSearches.map((search) => (
            <Pressable
              key={`${search}-${search.toLowerCase()}`}
              style={[styles.recentItem, { borderBottomColor: colors.border }]}
              onPress={() => onRecentSearch(search)}
              accessibilityRole="button"
              accessibilityLabel={`Recent search: ${search}`}
            >
              <Ionicons name="time-outline" size={16} color={colors.icon} />
              <Text style={[styles.recentText, { color: colors.text }]}>
                {search}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>
          Popular Categories
        </Text>
        <View style={styles.categoriesGrid}>
          {categories.slice(0, 4).map((category) => (
            <Pressable
              key={category.slug}
              style={[
                styles.categoryCard,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
              onPress={() => onCategoryPress(category.slug)}
              accessibilityRole="button"
              accessibilityLabel={`Category: ${category.name}`}
            >
              <Ionicons
                name={CATEGORY_ICONS[category.slug] || 'cube-outline'}
                size={24}
                color={colors.primary}
              />
              <Text style={[styles.categoryName, { color: colors.text }]}>
                {category.name}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
    </View>
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
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 16,
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go back"
            onPress={onBack}
            style={{
              minHeight: 48,
              minWidth: 48,
              justifyContent: 'center',
              alignItems: 'center',
            }}
          >
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <SearchShoppingActions
              colors={colors}
              showComparison={
                hasSearchQuery && products.length > 0 && !searchError
              }
            />
          </View>
        </View>
        <SearchResultsHeader
          suggestions={
            isKeyboardVisible &&
            !isLoading &&
            !searchError &&
            onApplyAssistance ? (
              <SearchAssistance
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
                onBottomSpaceChange={setBottomSpace}
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
        {hasSearchQuery ? renderResults() : renderSuggestions()}
      </SafeAreaView>
    </SearchComparisonSession>
  );
}
