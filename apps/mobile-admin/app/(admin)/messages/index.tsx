import Ionicons from '@react-native-vector-icons/ionicons';
import { FlashList } from '@shopify/flash-list';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { ConversationListItem } from '@/components/messages/ConversationListItem';
import { FloatingSearchBar } from '@/components/messages/FloatingSearchBar';
import { InboxSearchResults } from '@/components/messages/InboxSearchResults';
import { InboxViewChips } from '@/components/messages/InboxViewChips';
import { AppKeyboardContainer } from '@/components/ui/AppKeyboardContainer';
import { SPACING, TYPOGRAPHY } from '@/constants/theme';
import { useInboxConversations } from '@/hooks/useInboxConversations';
import { useInboxSearch } from '@/hooks/useInboxSearch';
import { useTheme } from '@/hooks/useTheme';
import { NetworkError } from '@/lib/api-client';
import { sortInbox } from '@/lib/merchant-inbox-sort';
import type { InboxView } from '@/schemas/merchant-inbox';

/**
 * The chat engine pages by recent activity, so the views that rank chats by
 * priority or waiting time load a few pages up front and sort across them;
 * older chats join the ranking as more pages load on scroll.
 */
const MIN_ROWS_BEFORE_PAUSE = 8;
const MAX_AUTO_PAGES = 5;
const RANKED_VIEWS: readonly InboxView[] = [
  'needs_reply',
  'unread',
  'follow_up',
  'returning',
];

const EMPTY: Record<InboxView, { title: string; body: string }> = {
  needs_reply: {
    title: 'You are all caught up',
    body: 'Chats waiting for your reply show up here.',
  },
  unread: { title: 'No unread chats', body: 'New messages show up here.' },
  follow_up: {
    title: 'No follow-ups',
    body: 'Use Follow up inside a chat to bring it back at the right time.',
  },
  returning: {
    title: 'No customer chats',
    body: 'Chats from signed-in customers who have ordered before show up here.',
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

function errorText(error: unknown): string {
  if (error instanceof NetworkError && error.statusCode === 403) {
    return 'You do not have permission to read customer messages.';
  }
  if (error instanceof NetworkError && error.statusCode === 404) {
    return 'Messages are not set up for this store yet.';
  }
  return 'Could not load messages. Please try again.';
}

export default function MessagesScreen() {
  const { colors } = useTheme();
  const [refreshing, setRefreshing] = useState(false);
  const [view, setView] = useState<InboxView>('needs_reply');
  const [term, setTerm] = useState('');
  const query = useInboxConversations(view);
  const search = useInboxSearch(term);
  const searching = term.length > 0;
  const conversations = sortInbox(
    query.data?.pages.flatMap((p) => p.conversations) ?? [],
    view
  );
  const pages = query.data?.pages.length ?? 0;

  // Ranked views load several pages so the top of the list is truly the most
  // important; the others only keep loading while a narrowed view is short.
  useEffect(() => {
    if (
      query.hasNextPage &&
      !query.isFetchingNextPage &&
      pages < MAX_AUTO_PAGES &&
      (RANKED_VIEWS.includes(view) ||
        conversations.length < MIN_ROWS_BEFORE_PAUSE)
    ) {
      query.fetchNextPage();
    }
  }, [
    query.hasNextPage,
    query.isFetchingNextPage,
    query.fetchNextPage,
    conversations.length,
    pages,
    view,
  ]);

  const onRefresh = async () => {
    setRefreshing(true);
    await query.refetch();
    setRefreshing(false);
  };

  const summary =
    view === 'needs_reply' && conversations.length > 0
      ? conversations.length === 1
        ? '1 chat is waiting for your reply'
        : `${conversations.length} chats are waiting for your reply`
      : null;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <AppKeyboardContainer align="start" scrollEnabled={false}>
        {searching ? null : (
          <InboxViewChips colors={colors} onChange={setView} value={view} />
        )}
        <View style={styles.flex}>
          {searching ? (
            <InboxSearchResults
              colors={colors}
              isError={search.isError}
              isLoadingMore={search.isLoadingMore}
              isPending={search.isPending}
              onLoadMore={search.loadMore}
              results={search.results}
              term={term}
            />
          ) : query.isLoading ? (
            <View style={styles.centered}>
              <ActivityIndicator color={colors.primary} size="large" />
            </View>
          ) : query.isError && conversations.length === 0 ? (
            <View style={styles.centered}>
              <Text style={[styles.title, { color: colors.text }]}>
                {errorText(query.error)}
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  query.refetch();
                }}
                style={styles.retry}
              >
                <Text style={{ color: colors.primary }}>Tap to retry</Text>
              </Pressable>
            </View>
          ) : (
            <FlashList
              data={conversations}
              keyExtractor={(item) => String(item.id)}
              ListEmptyComponent={
                query.isFetchingNextPage || query.hasNextPage ? (
                  <View style={styles.centered}>
                    <ActivityIndicator color={colors.primary} />
                  </View>
                ) : (
                  <View style={styles.centered}>
                    <View
                      style={[
                        styles.emptyIcon,
                        { backgroundColor: colors.primaryLight },
                      ]}
                    >
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
                    <Text style={[styles.title, { color: colors.text }]}>
                      {EMPTY[view].title}
                    </Text>
                    <Text
                      style={{
                        color: colors.textSecondary,
                        textAlign: 'center',
                      }}
                    >
                      {EMPTY[view].body}
                    </Text>
                  </View>
                )
              }
              ListHeaderComponent={
                summary ? (
                  <Text
                    style={[styles.summary, { color: colors.textSecondary }]}
                  >
                    {summary}
                  </Text>
                ) : null
              }
              ListFooterComponent={
                query.isFetchingNextPage ? (
                  <ActivityIndicator color={colors.primary} />
                ) : null
              }
              onEndReached={() => {
                if (query.hasNextPage && !query.isFetchingNextPage) {
                  query.fetchNextPage();
                }
              }}
              refreshControl={
                <RefreshControl onRefresh={onRefresh} refreshing={refreshing} />
              }
              renderItem={({ item }) => (
                <ConversationListItem
                  colors={colors}
                  conversation={item}
                  onPress={(id) =>
                    router.push(`/(admin)/messages/${id}` as never)
                  }
                />
              )}
            />
          )}
        </View>
        <FloatingSearchBar
          colors={colors}
          onChangeText={setTerm}
          value={term}
        />
      </AppKeyboardContainer>
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
  container: { flex: 1 },
  emptyIcon: {
    alignItems: 'center',
    borderRadius: 40,
    height: 80,
    justifyContent: 'center',
    marginBottom: SPACING.sm,
    width: 80,
  },
  flex: { flex: 1 },
  retry: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: SPACING.touchTarget,
  },
  summary: {
    fontFamily: TYPOGRAPHY.fontFamily.medium,
    fontSize: TYPOGRAPHY.size.md,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
  },
  title: {
    fontFamily: TYPOGRAPHY.fontFamily.semiBold,
    fontSize: TYPOGRAPHY.size.lg,
    textAlign: 'center',
  },
});
