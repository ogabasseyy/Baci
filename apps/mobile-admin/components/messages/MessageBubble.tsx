import Ionicons from '@react-native-vector-icons/ionicons';
import { StyleSheet, Text, View } from 'react-native';
import {
  RADIUS,
  SPACING,
  type ThemeColors,
  TYPOGRAPHY,
} from '@/constants/theme';
import { formatInboxTime, inboxMessageText } from '@/lib/merchant-inbox-format';
import type { InboxMessage } from '@/schemas/merchant-inbox';

interface MessageBubbleProps {
  colors: ThemeColors;
  message: InboxMessage;
}

/** Shopper on the left; store (blue) and the automatic assistant (gold) on the right. */
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
  const textColor =
    isCustomer || isAssistant ? colors.text : colors.textOnPrimary;
  const metaColor =
    isCustomer || isAssistant ? colors.textMuted : colors.textOnPrimary;

  return (
    <View
      style={[styles.row, isCustomer ? styles.rowStart : styles.rowEnd]}
      testID={`message-${message.sender}`}
    >
      <View
        style={[
          styles.bubble,
          isCustomer && [
            styles.customerCorner,
            { backgroundColor: colors.card, borderColor: colors.border },
            styles.bordered,
          ],
          isAssistant && [
            styles.ownCorner,
            { backgroundColor: colors.goldLight, borderColor: colors.gold },
            styles.bordered,
          ],
          message.sender === 'store' && [
            styles.ownCorner,
            { backgroundColor: colors.primary },
          ],
        ]}
      >
        {isAssistant ? (
          <View style={styles.label}>
            <Ionicons color={colors.gold} name="sparkles" size={12} />
            <Text style={[styles.labelText, { color: colors.gold }]}>
              Assistant (automatic reply)
            </Text>
          </View>
        ) : null}
        <Text style={[styles.body, { color: textColor }]}>
          {inboxMessageText(message)}
        </Text>
        <Text style={[styles.time, { color: metaColor }]}>
          {message.sender === 'store' ? 'You · ' : ''}
          {formatInboxTime(message.createdAt)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bordered: { borderWidth: StyleSheet.hairlineWidth },
  body: { fontSize: TYPOGRAPHY.size.lg, lineHeight: 22 },
  bubble: {
    borderRadius: RADIUS.xl,
    maxWidth: '84%',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
  },
  customerCorner: { borderBottomLeftRadius: 6 },
  label: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
    marginBottom: 4,
  },
  labelText: {
    fontFamily: TYPOGRAPHY.fontFamily.semiBold,
    fontSize: TYPOGRAPHY.size.sm,
  },
  ownCorner: { borderBottomRightRadius: 6 },
  row: { flexDirection: 'row', marginVertical: 3 },
  rowEnd: { justifyContent: 'flex-end' },
  rowStart: { justifyContent: 'flex-start' },
  system: {
    fontSize: TYPOGRAPHY.size.sm,
    marginVertical: SPACING.sm,
    textAlign: 'center',
  },
  time: {
    fontSize: TYPOGRAPHY.size.xs + 1,
    marginTop: 4,
    opacity: 0.75,
    textAlign: 'right',
  },
});
