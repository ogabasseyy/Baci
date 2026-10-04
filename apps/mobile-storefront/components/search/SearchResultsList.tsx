import { FlashList } from '@shopify/flash-list';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { ProductCard } from '@/components/storefront/ProductCard';
import type Colors from '@/constants/Colors';
import type { Product } from '@/types/product';
import styles from './search-screen.styles';

interface SearchResultsListProps {
  colors: (typeof Colors)['light'];
  committedQuery: string;
  isLoadingMore: boolean;
  /** True when the footer error came from a next-page fetch (not a refetch). */
  isNextPageError: boolean;
  /** True while any retry/refetch request is in flight. */
  isRetrying: boolean;
  /** Retained-results failure (next-page or background refetch). Null when healthy. */
  listError: string | null;
  onEndReached: () => void;
  onProductPress: (product: Product) => void;
  /** Retries loaded pages after a background-refetch failure. */
  onRetry: () => void;
  /** Retries the failed next-page offset. */
  onRetryNextPage: () => void;
  products: Product[];
  /**
   * Result-set identity (committed query + refinements). Applied as the
   * list key so a new result set remounts at the top instead of
   * inheriting a previous query's scroll offset.
   */
  resultsKey: string;
  totalCount: number;
}

export default function SearchResultsList({
  colors,
  committedQuery,
  isLoadingMore,
  isNextPageError,
  isRetrying,
  listError,
  onEndReached,
  onProductPress,
  onRetry,
  onRetryNextPage,
  products,
  resultsKey,
  totalCount,
}: SearchResultsListProps) {
  const countText =
    totalCount > products.length
      ? `Showing ${products.length} of ${totalCount} results`
      : `${totalCount > 0 ? totalCount : products.length} result${(totalCount > 0 ? totalCount : products.length) === 1 ? '' : 's'}`;

  return (
    <FlashList
      key={resultsKey}
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
            {countText}
            {committedQuery ? ` for “${committedQuery}”` : ''}
          </Text>
        </View>
      }
      ListFooterComponent={
        isLoadingMore || (listError && isRetrying) ? (
          <View style={styles.resultsFooter}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
              {isLoadingMore ? 'Loading more…' : 'Retrying…'}
            </Text>
          </View>
        ) : listError ? (
          <View style={styles.resultsFooter}>
            <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
              {isNextPageError
                ? "Couldn't load more results."
                : "Couldn't refresh results."}
            </Text>
            <Pressable
              onPress={isNextPageError ? onRetryNextPage : onRetry}
              style={[styles.retryButton, { backgroundColor: colors.primary }]}
              accessibilityRole="button"
              accessibilityLabel={
                isNextPageError
                  ? 'Retry loading more results'
                  : 'Retry refreshing results'
              }
            >
              <Text
                style={[
                  styles.retryButtonText,
                  { color: colors.primaryForeground },
                ]}
              >
                Try again
              </Text>
            </Pressable>
          </View>
        ) : null
      }
    />
  );
}
