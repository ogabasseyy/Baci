import { StyleSheet, Text, View } from 'react-native';
import { SPACING, type ThemeColors, TYPOGRAPHY } from '@/constants/theme';
import {
  formatInboxTime,
  inboxMessageText,
  inboxSenderLabel,
} from '@/lib/merchant-inbox-format';
import type { InboxMessage } from '@/schemas/merchant-inbox';

interface MessageBubbleProps {
  colors: ThemeColors;
  message: InboxMessage;
}

/** Shopper on the left; store and assistant on the right, told apart by label and colour. */
export function MessageBubble({ colors, message }: MessageBubbleProps) {
  if (message.sender === 'system') {
    return (
      <Text style={[styles.system, { color: colors.textMuted }]}>
        {inboxMessageText(message)}
      </Text>
    );
  }

  const isCustomer = message.sender === 'customer';
  const isAssistant = message.sender === 'assistant';
  const background = isCustomer
    ? colors.card
    : isAssistant
      ? colors.goldLight
      : colors.primary;
  const textColor = isCustomer
    ? colors.text
    : isAssistant
      ? colors.text
      : colors.textOnPrimary;
  const label = inboxSenderLabel(message.sender);

  return (
    <View
      style={[styles.row, isCustomer ? styles.rowStart : styles.rowEnd]}
      testID={`message-${message.sender}`}
    >
      <View
        style={[
          styles.bubble,
          { backgroundColor: background, borderColor: colors.border },
          isCustomer && styles.bordered,
        ]}
      >
        {label ? (
          <Text style={[styles.label, { color: textColor }]}>
            {isAssistant ? 'Assistant (automatic reply)' : label}
          </Text>
        ) : null}
        <Text style={[styles.body, { color: textColor }]}>
          {inboxMessageText(message)}
        </Text>
        <Text style={[styles.time, { color: textColor }]}>
          {formatInboxTime(message.createdAt)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bordered: { borderWidth: StyleSheet.hairlineWidth },
  body: { fontSize: TYPOGRAPHY.size.md },
  bubble: {
    borderRadius: 16,
    maxWidth: '82%',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  label: {
    fontFamily: TYPOGRAPHY.fontFamily.semiBold,
    fontSize: TYPOGRAPHY.size.sm,
    marginBottom: 2,
    opacity: 0.8,
  },
  row: { flexDirection: 'row', marginVertical: SPACING.xs },
  rowEnd: { justifyContent: 'flex-end' },
  rowStart: { justifyContent: 'flex-start' },
  system: {
    fontSize: TYPOGRAPHY.size.sm,
    marginVertical: SPACING.sm,
    textAlign: 'center',
  },
  time: {
    fontSize: TYPOGRAPHY.size.xs,
    marginTop: 2,
    opacity: 0.7,
    textAlign: 'right',
  },
});
