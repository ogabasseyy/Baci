import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SPACING, type ThemeColors, TYPOGRAPHY } from '@/constants/theme';
import { formatInboxTime, inboxMessageText } from '@/lib/merchant-inbox-format';
import type { InboxConversation } from '@/schemas/merchant-inbox';

interface ConversationListItemProps {
  colors: ThemeColors;
  conversation: InboxConversation;
  onPress: (id: number) => void;
}

/** A conversation needs a reply when the shopper wrote last or has unread messages. */
export function needsReply(conversation: InboxConversation): boolean {
  return (
    conversation.unreadCount > 0 ||
    conversation.lastMessage?.sender === 'customer'
  );
}

export function ConversationListItem({
  colors,
  conversation,
  onPress,
}: ConversationListItemProps) {
  const last = conversation.lastMessage;
  const waiting = needsReply(conversation);
  const preview = last
    ? `${last.sender === 'store' ? 'You: ' : last.sender === 'assistant' ? 'Assistant: ' : ''}${inboxMessageText(last)}`
    : 'No messages yet';

  return (
    <Pressable
      accessibilityLabel={`Conversation with ${conversation.customerName}${waiting ? ', needs reply' : ''}`}
      accessibilityRole="button"
      onPress={() => onPress(conversation.id)}
      style={[
        styles.row,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <View style={styles.main}>
        <View style={styles.top}>
          <Text
            numberOfLines={1}
            style={[
              styles.name,
              {
                color: colors.text,
                fontFamily: waiting
                  ? TYPOGRAPHY.fontFamily.bold
                  : TYPOGRAPHY.fontFamily.medium,
              },
            ]}
          >
            {conversation.customerName}
          </Text>
          <Text style={[styles.time, { color: colors.textMuted }]}>
            {formatInboxTime(conversation.lastActivityAt)}
          </Text>
        </View>
        <Text
          numberOfLines={2}
          style={[styles.preview, { color: colors.textSecondary }]}
        >
          {preview}
        </Text>
        {waiting ? (
          <View style={[styles.badge, { backgroundColor: colors.goldLight }]}>
            <Text style={[styles.badgeText, { color: colors.text }]}>
              {conversation.unreadCount > 0
                ? `${conversation.unreadCount} new · needs reply`
                : 'Needs reply'}
            </Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    borderRadius: 10,
    marginTop: SPACING.sm,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
  },
  badgeText: {
    fontFamily: TYPOGRAPHY.fontFamily.semiBold,
    fontSize: TYPOGRAPHY.size.sm,
  },
  main: { flex: 1 },
  name: { flex: 1, fontSize: TYPOGRAPHY.size.lg },
  preview: { fontSize: TYPOGRAPHY.size.md, marginTop: 2 },
  row: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: SPACING.sm,
    minHeight: SPACING.touchTarget,
    padding: SPACING.md,
  },
  time: { fontSize: TYPOGRAPHY.size.sm, marginLeft: SPACING.sm },
  top: { alignItems: 'center', flexDirection: 'row' },
});
