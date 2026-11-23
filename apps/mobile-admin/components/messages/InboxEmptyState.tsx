import Ionicons from '@react-native-vector-icons/ionicons';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SPACING, type ThemeColors, TYPOGRAPHY } from '@/constants/theme';
import type { InboxView } from '@/schemas/merchant-inbox';

export const INBOX_EMPTY_COPY: Record<
  InboxView,
  { title: string; body: string }
> = {
  needs_reply: {
    title: 'You are all caught up',
    body: 'Chats waiting for your reply show up here.',
  },
  unread: { title: 'No unread chats', body: 'New messages show up here.' },
  follow_up: {
    title: 'No follow-ups',
    body: 'Use Follow up inside a chat to bring it back at the right time.',
  },
  done: {
    title: 'No finished chats yet',
    body: 'Chats you mark Done are kept here.',
  },
  all: {
    title: 'No messages yet',
    body: 'When a shopper writes to your store, the chat appears here.',
  },
};

interface InboxEmptyStateProps {
  /** True only while pages are still being loaded automatically. */
  loading: boolean;
  /** Older chats may exist beyond what was loaded (the list narrows pages). */
  canLoadMore: boolean;
  colors: ThemeColors;
  onLoadMore: () => void;
  view: InboxView;
}

/**
 * What an empty list shows. A view that narrows each page can be empty while
 * older pages still hold matches: a spinner is shown only while pages are
 * loading by themselves, never forever, and after that the person can look
 * further back on purpose.
 */
export function InboxEmptyState({
  canLoadMore,
  colors,
  loading,
  onLoadMore,
  view,
}: InboxEmptyStateProps) {
  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  const copy = INBOX_EMPTY_COPY[view];
  return (
    <View style={styles.centered}>
      <View style={[styles.icon, { backgroundColor: colors.primaryLight }]}>
        <Ionicons
          color={colors.primary}
          name={
            view === 'needs_reply'
              ? 'checkmark-done-outline'
              : 'chatbubbles-outline'
          }
          size={36}
        />
      </View>
      <Text style={[styles.title, { color: colors.text }]}>{copy.title}</Text>
      <Text style={{ color: colors.textSecondary, textAlign: 'center' }}>
        {copy.body}
      </Text>
      {canLoadMore ? (
        <Pressable
          accessibilityRole="button"
          onPress={onLoadMore}
          style={styles.more}
        >
          <Text style={{ color: colors.primary }}>Look further back</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  centered: {
    alignItems: 'center',
    flex: 1,
    gap: SPACING.sm,
    justifyContent: 'center',
    padding: SPACING.xl,
  },
  icon: {
    alignItems: 'center',
    borderRadius: 40,
    height: 80,
    justifyContent: 'center',
    marginBottom: SPACING.sm,
    width: 80,
  },
  more: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: SPACING.touchTarget,
  },
  title: {
    fontFamily: TYPOGRAPHY.fontFamily.semiBold,
    fontSize: TYPOGRAPHY.size.lg,
    textAlign: 'center',
  },
});
