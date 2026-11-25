import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  RADIUS,
  SPACING,
  type ThemeColors,
  TYPOGRAPHY,
} from '@/constants/theme';
import {
  formatInboxTime,
  inboxInitials,
  inboxMessageText,
} from '@/lib/merchant-inbox-format';
import type { InboxConversation } from '@/schemas/merchant-inbox';
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

export function badgeText(conversation: InboxConversation): string | null {
  const waiting = needsReply(conversation);
  if (conversation.unreadCount > 0) {
    return waiting
      ? `${conversation.unreadCount} new · needs reply`
      : `${conversation.unreadCount} new`;
  }
  return waiting ? 'Needs reply' : null;
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

export function ConversationListItem({
  colors,
  conversation,
  onPress,
  snippet,
}: ConversationListItemProps) {
  const waiting = needsReply(conversation);
  const badge = badgeText(conversation);
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
      <View
        style={[
          styles.avatar,
          { backgroundColor: waiting ? colors.goldLight : colors.primaryLight },
        ]}
      >
        <Text
          style={[
            styles.initials,
            { color: waiting ? colors.gold : colors.primary },
          ]}
        >
          {inboxInitials(conversation.customerName)}
        </Text>
      </View>
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
                  : TYPOGRAPHY.fontFamily.semiBold,
              },
            ]}
          >
            {conversation.customerName}
          </Text>
          <Text
            style={[
              styles.time,
              { color: waiting ? colors.gold : colors.textMuted },
            ]}
          >
            {formatInboxTime(conversation.lastActivityAt)}
          </Text>
        </View>
        <Text
          numberOfLines={2}
          style={[
            styles.preview,
            { color: waiting ? colors.text : colors.textSecondary },
          ]}
        >
          {preview}
        </Text>
        <ConversationMeta colors={colors} conversation={conversation} />
        {badge ? (
          <View style={[styles.badge, { backgroundColor: colors.goldLight }]}>
            <View style={[styles.dot, { backgroundColor: colors.gold }]} />
            <Text style={[styles.badgeText, { color: colors.gold }]}>
              {badge}
            </Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  avatar: {
    alignItems: 'center',
    borderRadius: RADIUS.full,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  badge: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: RADIUS.full,
    flexDirection: 'row',
    gap: 6,
    marginTop: SPACING.sm,
    paddingHorizontal: SPACING.sm + 2,
    paddingVertical: 3,
  },
  badgeText: {
    fontFamily: TYPOGRAPHY.fontFamily.semiBold,
    fontSize: TYPOGRAPHY.size.sm,
  },
  dot: { borderRadius: RADIUS.full, height: 6, width: 6 },
  initials: {
    fontFamily: TYPOGRAPHY.fontFamily.bold,
    fontSize: TYPOGRAPHY.size.lg,
  },
  main: { flex: 1 },
  name: { flex: 1, fontSize: TYPOGRAPHY.size.lg },
  preview: { fontSize: TYPOGRAPHY.size.md, lineHeight: 20, marginTop: 2 },
  row: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: SPACING.md,
    minHeight: 76,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md + 2,
  },
  time: { fontSize: TYPOGRAPHY.size.sm, marginLeft: SPACING.sm },
  top: { alignItems: 'center', flexDirection: 'row' },
});
