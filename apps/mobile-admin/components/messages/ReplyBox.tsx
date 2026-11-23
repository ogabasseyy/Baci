import Ionicons from '@react-native-vector-icons/ionicons';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  RADIUS,
  SPACING,
  type ThemeColors,
  TYPOGRAPHY,
} from '@/constants/theme';
import type { InboxReplyStatus } from '@/hooks/useInboxReply';
import { INBOX_REPLY_MAX_LENGTH } from '@/schemas/merchant-inbox';

interface ReplyBoxProps {
  canSend: boolean;
  colors: ThemeColors;
  draft: string;
  onChangeDraft: (value: string) => void;
  onSend: () => void;
  status: InboxReplyStatus;
}

const FAILURE_TEXT: Partial<Record<InboxReplyStatus, string>> = {
  failed: 'Message not sent. Your text is kept: tap Retry.',
  unconfirmed:
    'We could not confirm this was sent. Tap Retry and we will check first, so it is never sent twice.',
};

export function ReplyBox({
  canSend,
  colors,
  draft,
  onChangeDraft,
  onSend,
  status,
}: ReplyBoxProps) {
  const sending = status === 'sending';
  const failure = FAILURE_TEXT[status];
  const retrying = status === 'failed' || status === 'unconfirmed';
  const nearLimit = draft.length > INBOX_REPLY_MAX_LENGTH - 200;

  return (
    <View
      style={[
        styles.wrap,
        { backgroundColor: colors.card, borderTopColor: colors.border },
      ]}
    >
      {failure ? (
        <View style={[styles.error, { backgroundColor: colors.errorLight }]}>
          <Ionicons color={colors.error} name="alert-circle" size={16} />
          <Text
            accessibilityRole="alert"
            style={[styles.errorText, { color: colors.error }]}
          >
            {failure}
          </Text>
        </View>
      ) : null}
      <View style={styles.row}>
        <TextInput
          accessibilityLabel="Reply"
          editable={!sending}
          maxLength={INBOX_REPLY_MAX_LENGTH}
          multiline
          onChangeText={onChangeDraft}
          placeholder="Write a reply"
          placeholderTextColor={colors.textMuted}
          style={[
            styles.input,
            { backgroundColor: colors.inputBg, color: colors.text },
          ]}
          value={draft}
        />
        <Pressable
          accessibilityLabel={retrying ? 'Retry sending' : 'Send reply'}
          accessibilityRole="button"
          accessibilityState={{ disabled: !canSend, busy: sending }}
          disabled={!canSend}
          onPress={onSend}
          style={[
            retrying ? styles.retry : styles.send,
            { backgroundColor: canSend ? colors.primary : colors.border },
          ]}
        >
          {sending ? (
            <ActivityIndicator color={colors.textOnPrimary} />
          ) : retrying ? (
            <Text style={[styles.retryText, { color: colors.textOnPrimary }]}>
              Retry
            </Text>
          ) : (
            <Ionicons color={colors.textOnPrimary} name="arrow-up" size={22} />
          )}
        </Pressable>
      </View>
      {nearLimit ? (
        <Text style={[styles.counter, { color: colors.textMuted }]}>
          {draft.length}/{INBOX_REPLY_MAX_LENGTH}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  counter: { fontSize: TYPOGRAPHY.size.xs, marginTop: 4, textAlign: 'right' },
  error: {
    alignItems: 'center',
    borderRadius: RADIUS.md,
    flexDirection: 'row',
    gap: 8,
    marginBottom: SPACING.sm,
    padding: SPACING.sm + 2,
  },
  errorText: { flex: 1, fontSize: TYPOGRAPHY.size.sm },
  input: {
    borderRadius: RADIUS.xl,
    flex: 1,
    fontSize: TYPOGRAPHY.size.lg,
    maxHeight: 120,
    minHeight: SPACING.touchTarget,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.md + 2,
    paddingBottom: SPACING.md,
  },
  retry: {
    alignItems: 'center',
    borderRadius: RADIUS.full,
    height: SPACING.touchTarget,
    justifyContent: 'center',
    paddingHorizontal: SPACING.lg,
  },
  retryText: { fontFamily: TYPOGRAPHY.fontFamily.semiBold },
  row: { alignItems: 'flex-end', flexDirection: 'row', gap: SPACING.sm },
  send: {
    alignItems: 'center',
    borderRadius: RADIUS.full,
    height: SPACING.touchTarget,
    justifyContent: 'center',
    width: SPACING.touchTarget,
  },
  wrap: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.sm + 2,
  },
});
