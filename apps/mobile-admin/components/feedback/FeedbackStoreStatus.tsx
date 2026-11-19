import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { RADIUS, SPACING, TYPOGRAPHY } from '@/constants/theme';
import { useTheme } from '@/hooks/useTheme';

interface FeedbackStoreStatusProps {
  /** True while the active store is still being fetched. */
  isLoading: boolean;
  onRetry: () => void;
}

/**
 * Explains why Send is unavailable while the active store is missing, and
 * offers a retry when loading it failed, so a merchant with a connection
 * problem is never stuck with a silently disabled button.
 */
export function FeedbackStoreStatus({
  isLoading,
  onRetry,
}: FeedbackStoreStatusProps) {
  const { colors } = useTheme();

  if (isLoading) {
    return (
      <View style={styles.row}>
        <ActivityIndicator color={colors.textSecondary} size="small" />
        <Text style={[styles.text, { color: colors.textSecondary }]}>
          Loading your store…
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.row}>
      <Text
        accessibilityRole="alert"
        style={[styles.text, styles.grow, { color: colors.error }]}
      >
        We couldn’t load your store, so this report can’t be sent yet.
      </Text>
      <Pressable
        accessibilityLabel="Try loading your store again"
        accessibilityRole="button"
        onPress={onRetry}
        style={[styles.retry, { backgroundColor: colors.cardHover }]}
      >
        <Text style={[styles.retryText, { color: colors.text }]}>Retry</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  text: {
    fontFamily: TYPOGRAPHY.fontFamily.medium,
    fontSize: TYPOGRAPHY.size.sm,
  },
  grow: {
    flex: 1,
  },
  retry: {
    alignItems: 'center',
    borderRadius: RADIUS.md,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: SPACING.md,
  },
  retryText: {
    fontFamily: TYPOGRAPHY.fontFamily.semiBold,
    fontSize: TYPOGRAPHY.size.sm,
  },
});
