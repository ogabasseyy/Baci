import Ionicons, {
  type IoniconsIconName,
} from '@react-native-vector-icons/ionicons';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type Colors from '@/constants/Colors';
import type { Category, Product } from '@/types/product';
import { SearchFilterBar } from './SearchFilterBar';
import SearchResultsEmptyState from './SearchResultsEmptyState';
import SearchResultsErrorState from './SearchResultsErrorState';
import SearchResultsHeader from './SearchResultsHeader';
import SearchResultsList from './SearchResultsList';
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
  const renderResults = () => {
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

    if (isLoading) {
      return (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
            Searching…
          </Text>
        </View>
      );
    }

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
    const resultsKey = JSON.stringify([
      committedQuery,
      selectedBrand,
      selectedCategory,
      selectedCondition,
      minPrice,
      maxPrice,
      minRating,
    ]);

    return (
      <SearchResultsList
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
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={['top']}
    >
      <SearchResultsHeader
        colors={colors}
        onBack={onBack}
        onClearQuery={onClearQuery}
        onQueryChange={onQueryChange}
        onSubmitQuery={onSubmitQuery}
        query={query}
        showMinLengthHint={showMinLengthHint}
      />
      {hasSearchQuery && (
        <SearchFilterBar
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
      )}
      {hasSearchQuery ? renderResults() : renderSuggestions()}
    </SafeAreaView>
  );
}
