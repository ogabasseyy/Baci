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
  /** Next-page failure while earlier pages stay visible. Null when healthy. */
  listError: string | null;
  onEndReached: () => void;
  onProductPress: (product: Product) => void;
  /** Retries the failed next-page offset (footer only). */
  onRetryNextPage: () => void;
  products: Product[];
  totalCount: number;
}

export default function SearchResultsList({
  colors,
  committedQuery,
  isLoadingMore,
  listError,
  onEndReached,
  onProductPress,
  onRetryNextPage,
  products,
  totalCount,
}: SearchResultsListProps) {
  const countText =
    totalCount > products.length
      ? `Showing ${products.length} of ${totalCount} results`
      : `${totalCount > 0 ? totalCount : products.length} result${(totalCount > 0 ? totalCount : products.length) === 1 ? '' : 's'}`;

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
            {countText}
            {committedQuery ? ` for “${committedQuery}”` : ''}
          </Text>
        </View>
      }
      ListFooterComponent={
        isLoadingMore ? (
          <View style={styles.resultsFooter}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
              Loading more…
            </Text>
          </View>
        ) : listError ? (
          <View style={styles.resultsFooter}>
            <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
              Couldn&apos;t load more results.
            </Text>
            <Pressable
              onPress={onRetryNextPage}
              style={[styles.retryButton, { backgroundColor: colors.primary }]}
              accessibilityRole="button"
              accessibilityLabel="Retry loading more results"
            >
              <Text style={[styles.retryButtonText, { color: colors.white }]}>
                Try again
              </Text>
            </Pressable>
          </View>
        ) : null
      }
    />
  );
}
