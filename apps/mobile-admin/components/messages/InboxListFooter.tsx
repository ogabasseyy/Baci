import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';
import { SPACING, type ThemeColors } from '@/constants/theme';

interface InboxListFooterProps {
  /** Older chats exist and are no longer loaded just by reaching the end. */
  canLookBack: boolean;
  colors: ThemeColors;
  /** The last page could not be loaded. */
  failed: boolean;
  loading: boolean;
  onLoadMore: () => void;
  onRefresh: () => void;
  /** Refreshing the chats failed, which also stops older ones loading. */
  stale: boolean;
}

/** What sits under the last chat: progress, a retry, or older chats on request. */
export function InboxListFooter({
  canLookBack,
  colors,
  failed,
  loading,
  onLoadMore,
  onRefresh,
  stale,
}: InboxListFooterProps) {
  if (loading) return <ActivityIndicator color={colors.primary} />;
  if (!failed && !stale && !canLookBack) return null;
  // A failed page also reads as stale: asking for that page again comes first.
  const [label, onPress] = failed
    ? ['Could not load more chats. Tap to retry.', onLoadMore]
    : stale
      ? ['Could not update chats. Tap to retry.', onRefresh]
      : ['Look further back', onLoadMore];
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => onPress()}
      style={styles.button}
    >
      <Text style={{ color: colors.primary }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: SPACING.touchTarget,
  },
});
