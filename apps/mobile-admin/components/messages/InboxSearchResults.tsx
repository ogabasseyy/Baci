import { type Href, router } from 'expo-router';
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
import { FLOATING_SEARCH_CLEARANCE } from './FloatingSearchBar';

interface InboxSearchResultsProps {
  /** Safe-area room below the floating search pill, so rows can scroll clear. */
  bottomInset?: number;
  colors: ThemeColors;
  /** More pages exist; shown as a button when the pages so far had no match. */
  hasMore: boolean;
  isError: boolean;
  isLoadingMore: boolean;
  isPending: boolean;
  /** The page after the results on screen failed to load. */
  loadMoreFailed: boolean;
  onLoadMore: () => void;
  onRetry: () => void;
  results: { conversation: InboxConversation; snippet: string | null }[];
  term: string;
}

/** What the list shows while the search box has text. */
export function InboxSearchResults({
  bottomInset = 0,
  colors,
  hasMore,
  isError,
  isLoadingMore,
  isPending,
  loadMoreFailed,
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
      contentContainerStyle={{
        paddingBottom: FLOATING_SEARCH_CLEARANCE + bottomInset,
      }}
      data={results}
      keyboardShouldPersistTaps="handled"
      keyExtractor={(item) => String(item.conversation.id)}
      ListFooterComponent={
        isLoadingMore ? (
          <ActivityIndicator color={colors.primary} />
        ) : loadMoreFailed ? (
          <Pressable
            accessibilityRole="button"
            onPress={onRetry}
            style={styles.retry}
          >
            <Text style={{ color: colors.primary }}>
              Could not load more chats. Tap to retry.
            </Text>
          </Pressable>
        ) : undefined
      }
      onEndReached={() => {
        // The hook guards too; this keeps pending, failed and exhausted lists
        // quiet instead of repeating a failing request on every scroll.
        if (hasMore && !isLoadingMore && !loadMoreFailed) onLoadMore();
      }}
      ListEmptyComponent={
        <View style={styles.centered}>
          <Text style={[styles.title, { color: colors.text }]}>
            {hasMore
              ? `No match for "${term.trim()}" in the chats checked so far`
              : `No chats match "${term.trim()}"`}
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
          onPress={(id) => router.push(`/(admin)/messages/${id}` as Href)}
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
