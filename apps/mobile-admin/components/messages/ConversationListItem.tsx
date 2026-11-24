import Ionicons from '@react-native-vector-icons/ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  RADIUS,
  SPACING,
  type ThemeColors,
  TYPOGRAPHY,
} from '@/constants/theme';
import {
  formatInboxTime,
  inboxDisplayName,
  inboxMessageText,
} from '@/lib/merchant-inbox-format';
import { isWaitingLong } from '@/lib/merchant-inbox-waiting';
import type { InboxConversation } from '@/schemas/merchant-inbox';
import { ConversationAvatar } from './ConversationAvatar';
import { ConversationMeta } from './ConversationMeta';
import { conversationA11yLabel } from './conversationA11yLabel';

interface ConversationListItemProps {
  colors: ThemeColors;
  conversation: InboxConversation;
  onPress: (id: number) => void;
  /** Search results show the matching words instead of the last message. */
  snippet?: string | null;
}

/** Only a shopper's message waiting at the end of the chat needs an answer. */
export function needsReply(conversation: InboxConversation): boolean {
  return (
    conversation.lastMessage?.sender === 'customer' &&
    (conversation.status === 'open' || conversation.status === 'pending')
  );
}

function previewText(conversation: InboxConversation): string {
  const last = conversation.lastMessage;
  if (!last) return 'No messages yet';
  const prefix =
    last.sender === 'store'
      ? 'You: '
      : last.sender === 'assistant'
        ? 'Assistant: '
        : '';
  return `${prefix}${inboxMessageText(last)}`;
}

/**
 * One chat. Colour has one job each: blue says "new for you", and amber is
 * kept for a shopper who has waited more than a day. Unread chats get a bold
 * name and a count; a chat that only needs an answer gets a quiet reply mark.
 */
export function ConversationListItem({
  colors,
  conversation,
  onPress,
  snippet,
}: ConversationListItemProps) {
  const waiting = needsReply(conversation);
  const overdue = waiting && isWaitingLong(conversation.lastActivityAt);
  const unread = conversation.unreadCount > 0;
  const preview = snippet || previewText(conversation);

  return (
    <Pressable
      accessibilityLabel={conversationA11yLabel(conversation, {
        preview,
        waiting,
      })}
      accessibilityRole="button"
      android_ripple={{ color: colors.cardHover }}
      onPress={() => onPress(conversation.id)}
      style={[styles.row, { borderBottomColor: colors.border }]}
    >
      <ConversationAvatar colors={colors} name={conversation.customerName} />
      <View style={styles.main}>
        <View style={styles.top}>
          <Text
            numberOfLines={1}
            style={[
              styles.name,
              {
                color: colors.text,
                fontFamily: unread
                  ? TYPOGRAPHY.fontFamily.bold
                  : TYPOGRAPHY.fontFamily.semiBold,
              },
            ]}
          >
            {inboxDisplayName(conversation.customerName)}
          </Text>
          <Text
            style={[
              styles.time,
              { color: overdue ? colors.gold : colors.textMuted },
            ]}
          >
            {formatInboxTime(conversation.lastActivityAt)}
          </Text>
        </View>
        <View style={styles.bottom}>
          <Text
            numberOfLines={snippet ? 2 : 1}
            style={[
              styles.preview,
              {
                color: unread ? colors.text : colors.textSecondary,
                fontFamily: unread
                  ? TYPOGRAPHY.fontFamily.medium
                  : TYPOGRAPHY.fontFamily.regular,
              },
            ]}
          >
            {preview}
          </Text>
          {unread ? (
            <View style={[styles.count, { backgroundColor: colors.primary }]}>
              <Text style={[styles.countText, { color: colors.textOnPrimary }]}>
                {conversation.unreadCount > 99
                  ? '99+'
                  : conversation.unreadCount}
              </Text>
            </View>
          ) : waiting ? (
            <Ionicons
              color={overdue ? colors.gold : colors.primary}
              name="arrow-undo"
              size={16}
            />
          ) : null}
        </View>
        <ConversationMeta colors={colors} conversation={conversation} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bottom: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: SPACING.sm,
    marginTop: 2,
  },
  count: {
    alignItems: 'center',
    borderRadius: RADIUS.full,
    height: 20,
    justifyContent: 'center',
    minWidth: 20,
    paddingHorizontal: 6,
  },
  countText: {
    fontFamily: TYPOGRAPHY.fontFamily.bold,
    fontSize: TYPOGRAPHY.size.sm,
  },
  main: { flex: 1 },
  name: { flex: 1, fontSize: TYPOGRAPHY.size.lg },
  preview: { flex: 1, fontSize: TYPOGRAPHY.size.md, lineHeight: 20 },
  row: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: SPACING.md,
    minHeight: 72,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
  },
  time: { fontSize: TYPOGRAPHY.size.sm, marginLeft: SPACING.sm },
  top: { alignItems: 'center', flexDirection: 'row' },
});
