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
}

/** What sits under the last chat: progress, a retry, or older chats on request. */
export function InboxListFooter({
  canLookBack,
  colors,
  failed,
  loading,
  onLoadMore,
}: InboxListFooterProps) {
  if (loading) return <ActivityIndicator color={colors.primary} />;
  if (!failed && !canLookBack) return null;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onLoadMore}
      style={styles.button}
    >
      <Text style={{ color: colors.primary }}>
        {failed
          ? 'Could not load more chats. Tap to retry.'
          : 'Look further back'}
      </Text>
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
