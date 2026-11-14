import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { RADIUS, SPACING, TYPOGRAPHY } from '@/constants/theme';
import { useTheme } from '@/hooks/useTheme';
import {
  collectFeedbackDiagnostics,
  sendFeedbackReport,
} from '@/lib/feedback-report';

const MAX_LENGTH = 4000;

interface FeedbackFormProps {
  /** Route the merchant was on when they opened feedback. */
  screen: string | null;
  onCancel: () => void;
  onSent: () => void;
  /** Hide the heading when the host screen's header already names it. */
  showTitle?: boolean;
}

// Module scope: React Compiler does not lower try/catch inside components.
async function submitFeedback(
  message: string,
  screen: string | null
): Promise<string | null> {
  try {
    await sendFeedbackReport(message, collectFeedbackDiagnostics(screen));
    return null;
  } catch (error) {
    return error instanceof Error && error.message
      ? error.message
      : 'Could not send feedback. Please try again.';
  }
}

export function FeedbackForm({
  screen,
  onCancel,
  onSent,
  showTitle = true,
}: FeedbackFormProps) {
  const { colors } = useTheme();
  const [message, setMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canSend = message.trim().length > 0 && !isSending;

  const handleSend = async () => {
    if (!canSend) return;
    setIsSending(true);
    setError(null);
    const failure = await submitFeedback(message, screen);
    setIsSending(false);
    if (failure) {
      setError(failure);
      return;
    }
    setMessage('');
    onSent();
  };

  return (
    <View style={styles.container}>
      {showTitle ? (
        <Text
          accessibilityRole="header"
          style={[styles.title, { color: colors.text }]}
        >
          Send feedback
        </Text>
      ) : null}
      <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
        Report a bug, suggest an idea, or share what’s working well.
      </Text>
      <TextInput
        accessibilityLabel="Feedback message"
        autoFocus
        editable={!isSending}
        maxLength={MAX_LENGTH}
        multiline
        onChangeText={setMessage}
        placeholder="“The orders list didn’t update after I marked one as shipped.”"
        placeholderTextColor={colors.placeholder}
        style={[
          styles.input,
          {
            backgroundColor: colors.inputBg,
            borderColor: colors.primary,
            color: colors.text,
          },
        ]}
        textAlignVertical="top"
        value={message}
      />
      <Text style={[styles.note, { color: colors.textSecondary }]}>
        This report will include your message, the screen you’re on, and your
        app and device details.
      </Text>
      {error ? (
        <Text
          accessibilityRole="alert"
          style={[styles.error, { color: colors.error }]}
        >
          {error}
        </Text>
      ) : null}
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          disabled={isSending}
          onPress={onCancel}
          style={[styles.button, { backgroundColor: colors.cardHover }]}
        >
          <Text style={[styles.buttonText, { color: colors.text }]}>
            Cancel
          </Text>
        </Pressable>
        <Pressable
          accessibilityLabel="Send"
          accessibilityRole="button"
          accessibilityState={{ disabled: !canSend, busy: isSending }}
          disabled={!canSend}
          onPress={handleSend}
          style={[
            styles.button,
            { backgroundColor: colors.primary, opacity: canSend ? 1 : 0.5 },
          ]}
        >
          {isSending ? (
            <ActivityIndicator color={colors.textOnPrimary} size="small" />
          ) : (
            <Text style={[styles.buttonText, { color: colors.textOnPrimary }]}>
              Send
            </Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: SPACING.md,
  },
  title: {
    fontFamily: TYPOGRAPHY.fontFamily.semiBold,
    fontSize: TYPOGRAPHY.size['2xl'],
  },
  subtitle: {
    fontFamily: TYPOGRAPHY.fontFamily.regular,
    fontSize: TYPOGRAPHY.size.md,
  },
  input: {
    borderRadius: RADIUS.md,
    borderWidth: 1.5,
    fontFamily: TYPOGRAPHY.fontFamily.regular,
    fontSize: TYPOGRAPHY.size.lg,
    minHeight: 140,
    padding: SPACING.md,
  },
  note: {
    fontFamily: TYPOGRAPHY.fontFamily.regular,
    fontSize: TYPOGRAPHY.size.sm,
  },
  error: {
    fontFamily: TYPOGRAPHY.fontFamily.medium,
    fontSize: TYPOGRAPHY.size.md,
  },
  actions: {
    flexDirection: 'row',
    gap: SPACING.sm,
    justifyContent: 'flex-end',
  },
  button: {
    alignItems: 'center',
    borderRadius: RADIUS.md,
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 96,
    paddingHorizontal: SPACING.lg,
  },
  buttonText: {
    fontFamily: TYPOGRAPHY.fontFamily.semiBold,
    fontSize: TYPOGRAPHY.size.md,
  },
});
