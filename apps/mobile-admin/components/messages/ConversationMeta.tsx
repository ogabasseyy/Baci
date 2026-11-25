import Ionicons from '@react-native-vector-icons/ionicons';
import { StyleSheet, Text, View } from 'react-native';
import {
  RADIUS,
  SPACING,
  type ThemeColors,
  TYPOGRAPHY,
} from '@/constants/theme';
import { formatFollowUp, formatInboxTag } from '@/lib/merchant-inbox-format';
import { isFollowUpDue } from '@/lib/merchant-inbox-sort';
import type { InboxConversation } from '@/schemas/merchant-inbox';

const MAX_VISIBLE_TAGS = 2;

export const PRIORITY_LABEL = {
  urgent: 'Urgent',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
} as const;

/** Priority, follow-up and tags for a chat; renders nothing when there are none. */
export function ConversationMeta({
  colors,
  conversation,
}: {
  colors: ThemeColors;
  conversation: InboxConversation;
}) {
  const tags = conversation.tags ?? [];
  const followUp =
    !!conversation.followUp && conversation.status !== 'resolved';
  if (!conversation.priority && !followUp && tags.length === 0) return null;

  const hot =
    conversation.priority === 'urgent' || conversation.priority === 'high';
  const due = isFollowUpDue(conversation);
  const hidden = tags.length - MAX_VISIBLE_TAGS;

  return (
    <View style={styles.row}>
      {conversation.priority ? (
        <View
          style={[
            styles.pill,
            { backgroundColor: hot ? colors.errorLight : colors.warningLight },
          ]}
        >
          <Ionicons
            color={hot ? colors.error : colors.warning}
            name="flag"
            size={12}
          />
          <Text
            style={[
              styles.text,
              { color: hot ? colors.error : colors.warning },
            ]}
          >
            {PRIORITY_LABEL[conversation.priority]}
          </Text>
        </View>
      ) : null}
      {followUp ? (
        <View
          style={[
            styles.pill,
            { backgroundColor: due ? colors.errorLight : colors.primaryLight },
          ]}
        >
          <Ionicons
            color={due ? colors.error : colors.primary}
            name="alarm-outline"
            size={12}
          />
          <Text
            style={[
              styles.text,
              { color: due ? colors.error : colors.primary },
            ]}
          >
            {formatFollowUp(conversation.snoozedUntil, due)}
          </Text>
        </View>
      ) : null}
      {tags.slice(0, MAX_VISIBLE_TAGS).map((tag) => (
        <View
          key={tag}
          style={[styles.pill, { backgroundColor: colors.cardHover }]}
        >
          <Text style={[styles.text, { color: colors.textSecondary }]}>
            {formatInboxTag(tag)}
          </Text>
        </View>
      ))}
      {hidden > 0 ? (
        <Text style={[styles.text, { color: colors.textMuted }]}>
          +{hidden}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignItems: 'center',
    borderRadius: RADIUS.full,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: SPACING.sm + 2,
    paddingVertical: 3,
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.xs + 2,
    marginTop: SPACING.sm,
  },
  text: {
    fontFamily: TYPOGRAPHY.fontFamily.semiBold,
    fontSize: TYPOGRAPHY.size.sm,
  },
});
