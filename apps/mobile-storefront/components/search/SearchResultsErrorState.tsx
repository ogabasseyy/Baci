import Ionicons from '@react-native-vector-icons/ionicons';
import { Pressable, Text, View } from 'react-native';
import type Colors from '@/constants/Colors';
import styles from './search-screen.styles';

interface SearchResultsErrorStateProps {
  colors: (typeof Colors)['light'];
  committedQuery: string;
  onRetry: () => void;
}

export default function SearchResultsErrorState({
  colors,
  committedQuery,
  onRetry,
}: SearchResultsErrorStateProps) {
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
        <Text
          style={[styles.retryButtonText, { color: colors.primaryForeground }]}
        >
          Try again
        </Text>
      </Pressable>
    </View>
  );
}
