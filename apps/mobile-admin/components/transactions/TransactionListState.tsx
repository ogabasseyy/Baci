import Ionicons from '@react-native-vector-icons/ionicons';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { styles } from '@/components/transactions/transactions.styles';
import type { ThemeColors } from '@/constants/theme';

interface TransactionListStateProps {
  colors: ThemeColors;
  error: Error | null;
  hasOrders: boolean;
  isLoading: boolean;
  isRetrying: boolean;
  onRetry: () => void;
  searching?: boolean;
  searchTruncated?: boolean;
  visibleOrderCount: number;
}

export function TransactionListState({
  colors,
  error,
  hasOrders,
  isLoading,
  isRetrying,
  onRetry,
  searching,
  searchTruncated,
  visibleOrderCount,
}: TransactionListStateProps) {
  if (isLoading && !hasOrders) {
    return (
      <View style={styles.stateContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (error && !hasOrders) {
    return (
      <View style={styles.stateContainer}>
        <Ionicons name="alert-circle-outline" size={32} color={colors.error} />
        <Text style={[styles.stateText, { color: colors.textSecondary }]}>
          Unable to load transactions.
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retry loading transactions"
          disabled={isRetrying}
          onPress={onRetry}
          style={({ pressed }) => [
            styles.actionButton,
            {
              backgroundColor: colors.primary,
              opacity: isRetrying ? 0.6 : pressed ? 0.7 : 1,
            },
          ]}
        >
          {isRetrying ? (
            <ActivityIndicator color={colors.textOnPrimary} />
          ) : (
            <Text
              style={[styles.actionButtonText, { color: colors.textOnPrimary }]}
            >
              Try again
            </Text>
          )}
        </Pressable>
      </View>
    );
  }

  if (!hasOrders && !searching) {
    return (
      <View style={styles.stateContainer}>
        <Ionicons name="receipt-outline" size={32} color={colors.textMuted} />
        <Text style={[styles.stateText, { color: colors.textSecondary }]}>
          No transactions yet.
        </Text>
      </View>
    );
  }

  if (visibleOrderCount === 0 || !hasOrders) {
    return (
      <View style={styles.stateContainer}>
        <Ionicons name="search-outline" size={32} color={colors.textMuted} />
        <Text style={[styles.stateText, { color: colors.textSecondary }]}>
          No matching transactions.
        </Text>
      </View>
    );
  }

  if (searchTruncated) {
    // Name the displayed count, not the cap: refinement and tab paging can
    // shrink 101 candidates to a handful of visible rows.
    const matchNoun = visibleOrderCount === 1 ? 'match' : 'matches';
    return (
      <View style={styles.stateContainer}>
        <Text style={[styles.stateText, { color: colors.textSecondary }]}>
          {`Showing ${visibleOrderCount} ${matchNoun} (partial results). Refine your search to narrow results.`}
        </Text>
      </View>
    );
  }

  return null;
}
