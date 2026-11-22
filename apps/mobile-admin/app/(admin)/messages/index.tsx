import Ionicons from '@react-native-vector-icons/ionicons';
import { FlashList } from '@shopify/flash-list';
import { router } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  ConversationListItem,
  needsReply,
} from '@/components/messages/ConversationListItem';
import { SPACING, TYPOGRAPHY } from '@/constants/theme';
import { useInboxConversations } from '@/hooks/useInboxConversations';
import { useTheme } from '@/hooks/useTheme';
import { NetworkError } from '@/lib/api-client';

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
  const query = useInboxConversations();
  const conversations = query.data?.pages.flatMap((p) => p.conversations) ?? [];

  const waiting = conversations.filter(needsReply).length;

  const onRefresh = async () => {
    setRefreshing(true);
    await query.refetch();
    setRefreshing(false);
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {query.isLoading ? (
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
            <View style={styles.centered}>
              <View
                style={[
                  styles.emptyIcon,
                  { backgroundColor: colors.primaryLight },
                ]}
              >
                <Ionicons
                  color={colors.primary}
                  name="chatbubbles-outline"
                  size={36}
                />
              </View>
              <Text style={[styles.title, { color: colors.text }]}>
                No messages yet
              </Text>
              <Text
                style={{ color: colors.textSecondary, textAlign: 'center' }}
              >
                When a shopper writes to your store, the chat appears here.
              </Text>
            </View>
          }
          ListHeaderComponent={
            waiting > 0 ? (
              <Text style={[styles.summary, { color: colors.textSecondary }]}>
                {waiting === 1
                  ? '1 chat is waiting for your reply'
                  : `${waiting} chats are waiting for your reply`}
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
              onPress={(id) => router.push(`/(admin)/messages/${id}` as never)}
            />
          )}
        />
      )}
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
  summary: {
    fontFamily: TYPOGRAPHY.fontFamily.medium,
    fontSize: TYPOGRAPHY.size.md,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
  },
  retry: {
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
