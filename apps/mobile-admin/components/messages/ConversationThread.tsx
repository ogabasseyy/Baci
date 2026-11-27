import { router, Stack, useNavigation } from 'expo-router';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { ConversationActions } from '@/components/messages/ConversationActions';
import { CustomerCard } from '@/components/messages/CustomerCard';
import { CustomerUnavailable } from '@/components/messages/CustomerUnavailable';
import { MessageBubble } from '@/components/messages/MessageBubble';
import { ReplyBox } from '@/components/messages/ReplyBox';
import { AppHeaderKeyboardContainer } from '@/components/ui/AppHeaderKeyboardContainer';
import { SPACING, TYPOGRAPHY } from '@/constants/theme';
import { useInboxCustomer } from '@/hooks/useInboxCustomer';
import { useInboxManage } from '@/hooks/useInboxManage';
import { useInboxReply } from '@/hooks/useInboxReply';
import { useInboxThread } from '@/hooks/useInboxThread';
import { useTheme } from '@/hooks/useTheme';
import { inboxDisplayName } from '@/lib/merchant-inbox-format';
import { buildThreadRows } from '@/lib/merchant-inbox-rows';

export function ConversationThread({
  conversationId,
}: {
  conversationId: number;
}) {
  const { colors } = useTheme();
  const navigation = useNavigation();
  const thread = useInboxThread(conversationId);
  const { messages, conversation, refetch } = thread;
  const customer = useInboxCustomer({
    conversationId,
    merchantId: thread.merchantId,
  });
  const manage = useInboxManage({
    conversationId,
    merchantId: thread.merchantId,
  });
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
  const rows = buildThreadRows(messages).reverse();

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen
        options={{
          title: conversation
            ? inboxDisplayName(conversation.customerName)
            : 'Conversation',
        }}
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
        <AppHeaderKeyboardContainer>
          {conversation ? (
            <ConversationActions
              busy={manage.isUpdating}
              colors={colors}
              conversation={conversation}
              onDone={() => {
                // Done can finish after the owner already left this chat
                // (back button or swipe): never pop whichever screen is open.
                if (navigation.isFocused()) router.back();
              }}
              onUpdate={manage.update}
            />
          ) : null}
          {/* A failed check says so: never loaded, or the card below may be
              old. A chat already confirmed as a guest (null) stays quiet, with
              nothing to hide or retry. */}
          {customer.isError && customer.data !== null ? (
            <CustomerUnavailable
              colors={colors}
              onRetry={() => {
                customer.refetch();
              }}
              stale={!!customer.data}
            />
          ) : null}
          {customer.data ? (
            <CustomerCard colors={colors} customer={customer.data} />
          ) : null}
          <FlatList
            contentContainerStyle={styles.list}
            data={rows}
            inverted
            keyboardShouldPersistTaps="handled"
            keyExtractor={(item) => item.key}
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
            renderItem={({ item }) =>
              item.kind === 'day' ? (
                <View style={styles.dayWrap}>
                  <Text
                    style={[
                      styles.day,
                      {
                        backgroundColor: colors.card,
                        color: colors.textSecondary,
                      },
                    ]}
                  >
                    {item.label}
                  </Text>
                </View>
              ) : (
                <MessageBubble colors={colors} message={item.message} />
              )
            }
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
        </AppHeaderKeyboardContainer>
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
  day: {
    borderRadius: 12,
    fontFamily: TYPOGRAPHY.fontFamily.medium,
    fontSize: TYPOGRAPHY.size.sm,
    overflow: 'hidden',
    paddingHorizontal: SPACING.md,
    paddingVertical: 4,
  },
  dayWrap: { alignItems: 'center', marginVertical: SPACING.md },
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
