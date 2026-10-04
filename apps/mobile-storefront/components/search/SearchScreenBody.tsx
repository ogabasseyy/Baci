import {
  hasActiveSearchRefinements,
  type SearchRefinements,
} from '@baci/shared/lib';
import Ionicons, {
  type IoniconsIconName,
} from '@react-native-vector-icons/ionicons';
import {
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import type Colors from '@/constants/Colors';
import type { Category, Product } from '@/types/product';
import SearchLoadingCards from './SearchLoadingCards';
import SearchResultsEmptyState from './SearchResultsEmptyState';
import SearchResultsErrorState from './SearchResultsErrorState';
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

interface SearchScreenBodyProps {
  bottomSpace: number;
  categories: Category[];
  colors: (typeof Colors)['light'];
  committedQuery: string;
  hasSearchQuery: boolean;
  insetsBottom: number;
  invalidFilters?: boolean;
  isKeyboardVisible: boolean;
  isLoading: boolean;
  isLoadingMore: boolean;
  isNextPageError: boolean;
  isOnline: boolean;
  isRetrying: boolean;
  keyboardHeight: number;
  onCategoryPress: (slug: string) => void;
  onEndReached: () => void;
  onProductPress: (product: Product) => void;
  onRecentSearch: (query: string) => void;
  onRetry: () => void;
  onRetryNextPage: () => void;
  onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  products: Product[];
  recentSearches: string[];
  refinements?: SearchRefinements;
  resultsKey: string;
  searchError: string | null;
  totalCount: number;
}

export default function SearchScreenBody({
  bottomSpace,
  categories,
  colors,
  committedQuery,
  hasSearchQuery,
  insetsBottom,
  invalidFilters,
  isKeyboardVisible,
  isLoading,
  isLoadingMore,
  isNextPageError,
  isOnline,
  isRetrying,
  keyboardHeight,
  onCategoryPress,
  onEndReached,
  onProductPress,
  onRecentSearch,
  onRetry,
  onRetryNextPage,
  onScroll,
  products,
  recentSearches,
  refinements,
  resultsKey,
  searchError,
  totalCount,
}: SearchScreenBodyProps) {
  if (!hasSearchQuery) {
    // Idle suggestions scroll with the same dock clearance as the results
    // list: a full history or enlarged text would otherwise render behind
    // the bottom-docked search field with no way to reach it.
    return (
      <ScrollView
        style={styles.suggestionsContainer}
        contentContainerStyle={{
          paddingBottom: isKeyboardVisible
            ? keyboardHeight + 100
            : Math.max(100 + insetsBottom, bottomSpace),
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            Recent Searches
          </Text>
          <View style={styles.recentList}>
            {recentSearches.map((search) => (
              <Pressable
                key={`${search}-${search.toLowerCase()}`}
                style={[
                  styles.recentItem,
                  { borderBottomColor: colors.border },
                ]}
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
      </ScrollView>
    );
  }
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
        hasActiveRefinements={
          refinements !== undefined && hasActiveSearchRefinements(refinements)
        }
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
          : Math.max(100 + insetsBottom, bottomSpace)
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
      onScroll={onScroll}
    />
  );
}
