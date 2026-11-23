import { router } from 'expo-router';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SPACING, type ThemeColors, TYPOGRAPHY } from '@/constants/theme';
import type { InboxConversation } from '@/schemas/merchant-inbox';
import { ConversationListItem } from './ConversationListItem';

interface InboxSearchResultsProps {
  colors: ThemeColors;
  /** More pages exist; shown as a button when the pages so far had no match. */
  hasMore: boolean;
  isError: boolean;
  isLoadingMore: boolean;
  isPending: boolean;
  onLoadMore: () => void;
  onRetry: () => void;
  results: { conversation: InboxConversation; snippet: string | null }[];
  term: string;
}

/** What the list shows while the search box has text. */
export function InboxSearchResults({
  colors,
  hasMore,
  isError,
  isLoadingMore,
  isPending,
  onLoadMore,
  onRetry,
  results,
  term,
}: InboxSearchResultsProps) {
  if (term.trim().length < 2) {
    return (
      <View style={styles.centered}>
        <Text style={{ color: colors.textSecondary, textAlign: 'center' }}>
          Type at least 2 letters to search names and messages.
        </Text>
      </View>
    );
  }
  if (isPending) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (isError) {
    return (
      <View style={styles.centered}>
        <Text style={[styles.title, { color: colors.text }]}>
          Search is not available right now.
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={onRetry}
          style={styles.retry}
        >
          <Text style={{ color: colors.primary }}>Tap to retry</Text>
        </Pressable>
      </View>
    );
  }
  return (
    <FlatList
      data={results}
      keyboardShouldPersistTaps="handled"
      keyExtractor={(item) => String(item.conversation.id)}
      ListFooterComponent={
        isLoadingMore ? <ActivityIndicator color={colors.primary} /> : undefined
      }
      onEndReached={onLoadMore}
      ListEmptyComponent={
        <View style={styles.centered}>
          <Text style={[styles.title, { color: colors.text }]}>
            No chats match "{term.trim()}"
          </Text>
          {/* An empty list may never fire onEndReached, so older chats get a button. */}
          {hasMore && !isLoadingMore ? (
            <Pressable
              accessibilityRole="button"
              onPress={onLoadMore}
              style={styles.retry}
            >
              <Text style={{ color: colors.primary }}>Look further back</Text>
            </Pressable>
          ) : null}
        </View>
      }
      renderItem={({ item }) => (
        <ConversationListItem
          colors={colors}
          conversation={item.conversation}
          onPress={(id) => router.push(`/(admin)/messages/${id}` as never)}
          snippet={item.snippet}
        />
      )}
    />
  );
}

const styles = StyleSheet.create({
  retry: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: SPACING.touchTarget,
  },
  centered: {
    alignItems: 'center',
    gap: SPACING.sm,
    justifyContent: 'center',
    padding: SPACING.xl,
  },
  title: {
    fontFamily: TYPOGRAPHY.fontFamily.semiBold,
    fontSize: TYPOGRAPHY.size.lg,
    textAlign: 'center',
  },
});
