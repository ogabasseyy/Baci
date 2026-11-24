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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ConversationListItem } from '@/components/messages/ConversationListItem';
import {
  FLOATING_SEARCH_CLEARANCE,
  FloatingSearchBar,
} from '@/components/messages/FloatingSearchBar';
import { InboxEmptyState } from '@/components/messages/InboxEmptyState';
import { InboxSearchResults } from '@/components/messages/InboxSearchResults';
import { InboxViewChips } from '@/components/messages/InboxViewChips';
import { AppHeaderKeyboardContainer } from '@/components/ui/AppHeaderKeyboardContainer';
import { KeyboardInsetView } from '@/components/ui/KeyboardInsetView';
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
  // The lists run to the screen edge, under the floating search pill, so the
  // safe area is left to them and to the pill instead of a padded strip.
  const bottomInset = Math.max(useSafeAreaInsets().bottom, SPACING.md);
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
  // A failed page keeps its data and hasNextPage: never auto-retry it (that
  // would hammer the API during an outage); the footer offers the retry.
  const pageFailed = query.isError || query.isFetchNextPageError;
  // Pages still being loaded by themselves; false once the cap is reached, so
  // an empty narrowed view ends in its empty message instead of a spinner.
  const autoLoading =
    !pageFailed &&
    !!query.hasNextPage &&
    pages < MAX_AUTO_PAGES &&
    (RANKED_VIEWS.includes(view) ||
      conversations.length < MIN_ROWS_BEFORE_PAUSE);
  // Wait for any fetch to finish, not only a next-page one: fetchNextPage
  // cancels a refresh of the cached pages that is still running, which would
  // throw the refreshed first page away.
  useEffect(() => {
    if (autoLoading && !query.isFetching) query.fetchNextPage();
  }, [autoLoading, query.isFetching, query.fetchNextPage, pages]);

  const onRefresh = async () => {
    setRefreshing(true);
    await query.refetch();
    setRefreshing(false);
  };

  // Only the pages loaded so far are counted: with more to come it is "at least".
  const summary =
    view === 'needs_reply' && conversations.length > 0
      ? query.hasNextPage
        ? `${conversations.length}+ chats are waiting for your reply`
        : conversations.length === 1
          ? '1 chat is waiting for your reply'
          : `${conversations.length} chats are waiting for your reply`
      : null;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <AppHeaderKeyboardContainer contentContainerStyle={{ paddingBottom: 0 }}>
        {searching ? null : (
          <InboxViewChips colors={colors} onChange={setView} value={view} />
        )}
        <View style={styles.stage}>
          <View style={styles.flex}>
            {searching ? (
              <InboxSearchResults
                bottomInset={bottomInset}
                colors={colors}
                hasMore={search.hasMore}
                isError={search.isError}
                isLoadingMore={search.isLoadingMore}
                isPending={search.isPending}
                loadMoreFailed={search.loadMoreFailed}
                onLoadMore={search.loadMore}
                onRetry={search.retry}
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
                contentContainerStyle={{
                  paddingBottom: FLOATING_SEARCH_CLEARANCE + bottomInset,
                }}
                data={conversations}
                keyExtractor={(item) => String(item.id)}
                ListEmptyComponent={
                  <InboxEmptyState
                    canLoadMore={
                      !!query.hasNextPage && !query.isFetchingNextPage
                    }
                    colors={colors}
                    loading={autoLoading || query.isFetchingNextPage}
                    onLoadMore={() => {
                      query.fetchNextPage();
                    }}
                    view={view}
                  />
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
                  ) : query.isFetchNextPageError ? (
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => {
                        query.fetchNextPage();
                      }}
                      style={styles.retry}
                    >
                      <Text style={{ color: colors.primary }}>
                        Could not load more chats. Tap to retry.
                      </Text>
                    </Pressable>
                  ) : null
                }
                onEndReached={() => {
                  if (
                    !pageFailed &&
                    query.hasNextPage &&
                    !query.isFetchingNextPage
                  ) {
                    query.fetchNextPage();
                  }
                }}
                refreshControl={
                  <RefreshControl
                    onRefresh={onRefresh}
                    refreshing={refreshing}
                  />
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
          <KeyboardInsetView
            opened={SPACING.sm}
            property="bottom"
            resting={bottomInset}
            style={styles.floating}
          >
            <FloatingSearchBar
              colors={colors}
              onChangeText={setTerm}
              value={term}
            />
          </KeyboardInsetView>
        </View>
      </AppHeaderKeyboardContainer>
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
  flex: { flex: 1 },
  floating: { left: 0, position: 'absolute', right: 0 },
  stage: { flex: 1 },
  retry: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: SPACING.touchTarget,
  },
  summary: {
    fontFamily: TYPOGRAPHY.fontFamily.medium,
    fontSize: TYPOGRAPHY.size.sm,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
  },
  title: {
    fontFamily: TYPOGRAPHY.fontFamily.semiBold,
    fontSize: TYPOGRAPHY.size.lg,
    textAlign: 'center',
  },
});
