import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SPACING, type ThemeColors, TYPOGRAPHY } from '@/constants/theme';
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

  return (
    <View style={[styles.wrap, { borderColor: colors.border }]}>
      {failure ? (
        <Text
          accessibilityRole="alert"
          style={[styles.error, { color: colors.error }]}
        >
          {failure}
        </Text>
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
            styles.send,
            { backgroundColor: canSend ? colors.primary : colors.border },
          ]}
        >
          {sending ? (
            <ActivityIndicator color={colors.textOnPrimary} />
          ) : (
            <Text style={[styles.sendText, { color: colors.textOnPrimary }]}>
              {retrying ? 'Retry' : 'Send'}
            </Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  error: { fontSize: TYPOGRAPHY.size.sm, marginBottom: SPACING.sm },
  input: {
    borderRadius: 18,
    flex: 1,
    fontSize: TYPOGRAPHY.size.md,
    maxHeight: 120,
    minHeight: SPACING.touchTarget,
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.md,
  },
  row: { alignItems: 'flex-end', flexDirection: 'row', gap: SPACING.sm },
  send: {
    alignItems: 'center',
    borderRadius: 24,
    justifyContent: 'center',
    minHeight: SPACING.touchTarget,
    minWidth: 72,
    paddingHorizontal: SPACING.lg,
  },
  sendText: { fontFamily: TYPOGRAPHY.fontFamily.semiBold },
  wrap: {
    borderTopWidth: StyleSheet.hairlineWidth,
    padding: SPACING.md,
  },
});
