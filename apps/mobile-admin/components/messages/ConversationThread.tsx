import { Stack } from 'expo-router';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { MessageBubble } from '@/components/messages/MessageBubble';
import { ReplyBox } from '@/components/messages/ReplyBox';
import { AppKeyboardContainer } from '@/components/ui/AppKeyboardContainer';
import { SPACING, TYPOGRAPHY } from '@/constants/theme';
import { useInboxReply } from '@/hooks/useInboxReply';
import { useInboxThread } from '@/hooks/useInboxThread';
import { useTheme } from '@/hooks/useTheme';

export function ConversationThread({
  conversationId,
}: {
  conversationId: number;
}) {
  const { colors } = useTheme();
  const thread = useInboxThread(conversationId);
  const { messages, conversation, refetch } = thread;
  const reply = useInboxReply({
    conversationId,
    merchantId: thread.merchantId,
    refreshThread: async () => {
      const result = await refetch();
      if (result.isError) throw result.error;
      return (result.data?.pages ?? []).flatMap((page) => page.messages);
    },
  });
  const latestId = messages.reduce((max, m) => Math.max(max, m.id), 0);
  // Newest first: the list is inverted so it opens at the latest message.
  const inverted = [...messages].reverse();

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen
        options={{ title: conversation?.customerName ?? 'Conversation' }}
      />
      {thread.isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : thread.isError && messages.length === 0 ? (
        <View style={styles.centered}>
          <Text style={[styles.title, { color: colors.text }]}>
            Could not load this conversation.
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              refetch();
            }}
            style={styles.retry}
          >
            <Text style={{ color: colors.primary }}>Tap to retry</Text>
          </Pressable>
        </View>
      ) : (
        <AppKeyboardContainer align="start" scrollEnabled={false}>
          <FlatList
            contentContainerStyle={styles.list}
            data={inverted}
            inverted
            keyboardShouldPersistTaps="handled"
            keyExtractor={(item) => String(item.id)}
            ListFooterComponent={
              thread.hasNextPage ? (
                <Pressable
                  accessibilityRole="button"
                  disabled={thread.isFetchingNextPage}
                  onPress={() => {
                    thread.fetchNextPage();
                  }}
                  style={styles.retry}
                >
                  <Text style={{ color: colors.primary }}>
                    {thread.isFetchingNextPage
                      ? 'Loading…'
                      : 'Load earlier messages'}
                  </Text>
                </Pressable>
              ) : undefined
            }
            renderItem={({ item }) => (
              <MessageBubble colors={colors} message={item} />
            )}
            style={styles.flex}
          />
          <ReplyBox
            canSend={reply.canSend}
            colors={colors}
            draft={reply.draft}
            onChangeDraft={reply.setDraft}
            onSend={() => {
              reply.send(latestId);
            }}
            status={reply.status}
          />
        </AppKeyboardContainer>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  centered: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: SPACING.xl,
  },
  container: { flex: 1 },
  flex: { flex: 1 },
  list: { padding: SPACING.lg },
  retry: {
    alignItems: 'center',
    minHeight: SPACING.touchTarget,
    justifyContent: 'center',
  },
  title: {
    fontFamily: TYPOGRAPHY.fontFamily.semiBold,
    fontSize: TYPOGRAPHY.size.lg,
    textAlign: 'center',
  },
});
