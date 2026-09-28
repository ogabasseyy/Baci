import Ionicons, {
  type IoniconsIconName,
} from '@react-native-vector-icons/ionicons';
import { FlashList } from '@shopify/flash-list';
import {
  ActivityIndicator,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FilterBar } from '@/components/storefront/FilterBar';
import { ProductCard } from '@/components/storefront/ProductCard';
import type Colors from '@/constants/Colors';
import type { Category, Product } from '@/types/product';
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
  isOnline: boolean;
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
  selectedCategory: string;
  selectedCondition: string;
  /** Total matches reported by the search backend. */
  totalCount: number;
  viewMode: 'grid' | 'list';
}

function formatResultsCount(totalCount: number, loadedCount: number) {
  if (totalCount > loadedCount) {
    return `Showing ${loadedCount} of ${totalCount} results`;
  }

  const count = totalCount > 0 ? totalCount : loadedCount;
  return `${count} result${count === 1 ? '' : 's'}`;
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
  isOnline,
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
    // path and the query input visible instead.
    if (searchError) {
      return (
        <View style={styles.emptyContainer}>
          <Ionicons
            name="alert-circle-outline"
            size={64}
            color={colors.textSecondary}
          />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>
            Couldn&apos;t load results
          </Text>
          <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
            Something went wrong while searching
            {committedQuery ? ` for “${committedQuery}”` : ''}. Check your
            connection and try again.
          </Text>
          <Pressable
            onPress={onRetry}
            style={[styles.retryButton, { backgroundColor: colors.primary }]}
            accessibilityRole="button"
            accessibilityLabel="Retry search"
          >
            <Text style={[styles.retryButtonText, { color: colors.white }]}>
              Try again
            </Text>
          </Pressable>
        </View>
      );
    }

    if (products.length === 0) {
      return (
        <View style={styles.emptyContainer}>
          <Ionicons
            name="search-outline"
            size={64}
            color={colors.textSecondary}
          />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>
            No results found
          </Text>
          <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
            {committedQuery
              ? `No products match “${committedQuery}”. Try a different spelling or browse a category.`
              : 'Try searching for something else'}
          </Text>
          {categories.length > 0 && (
            <View style={styles.browseChipsRow}>
              {categories.slice(0, 4).map((category) => (
                <Pressable
                  key={category.slug}
                  style={[
                    styles.browseChip,
                    {
                      backgroundColor: colors.card,
                      borderColor: colors.border,
                    },
                  ]}
                  onPress={() => onCategoryPress(category.slug)}
                  accessibilityRole="button"
                  accessibilityLabel={`Browse ${category.name}`}
                >
                  <Text style={[styles.browseChipText, { color: colors.text }]}>
                    {category.name}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>
      );
    }

    return (
      <FlashList
        data={products}
        renderItem={({ item, index }) => (
          <View
            style={[
              styles.productWrapper,
              index % 2 === 0 ? styles.productLeft : styles.productRight,
            ]}
          >
            <ProductCard product={item} onPress={() => onProductPress(item)} />
          </View>
        )}
        keyExtractor={(item) => item.id}
        numColumns={2}
        contentContainerStyle={styles.resultsContainer}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        onEndReached={onEndReached}
        onEndReachedThreshold={0.5}
        ListHeaderComponent={
          <View style={styles.resultsCountHeader}>
            <Text
              style={[styles.resultsCountText, { color: colors.textSecondary }]}
            >
              {formatResultsCount(totalCount, products.length)}
              {committedQuery ? ` for “${committedQuery}”` : ''}
            </Text>
          </View>
        }
        ListFooterComponent={
          isLoadingMore ? (
            <View style={styles.resultsFooter}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text
                style={[styles.loadingText, { color: colors.textSecondary }]}
              >
                Loading more…
              </Text>
            </View>
          ) : null
        }
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
      <View style={styles.header}>
        <Pressable
          onPress={onBack}
          style={styles.backButton}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </Pressable>
        <View
          style={[
            styles.searchInputContainer,
            { backgroundColor: colors.muted, borderColor: colors.border },
          ]}
        >
          <Ionicons name="search-outline" size={18} color={colors.icon} />
          <TextInput
            style={[styles.searchInput, { color: colors.text }]}
            accessibilityLabel="Search products"
            placeholder="Search products..."
            placeholderTextColor={colors.placeholder}
            value={query}
            onChangeText={onQueryChange}
            onSubmitEditing={onSubmitQuery}
            returnKeyType="search"
            autoCapitalize="none"
            autoCorrect={false}
          />
          {query.length > 0 && (
            <Pressable
              onPress={onClearQuery}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
            >
              <Ionicons name="close-circle" size={18} color={colors.icon} />
            </Pressable>
          )}
        </View>
      </View>
      {hasSearchQuery && (
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
      )}
      {hasSearchQuery ? renderResults() : renderSuggestions()}
    </SafeAreaView>
  );
}
