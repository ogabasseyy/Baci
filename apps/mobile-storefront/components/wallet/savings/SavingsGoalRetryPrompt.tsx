import { Pressable, StyleSheet, Text, View } from 'react-native';
import type Colors from '@/constants/Colors';
import { palette } from '@/constants/Colors';
import { openSavingsSupport } from './open-savings-support';

type Props = {
  colors: (typeof Colors)['light'];
  /** The plan, so the support message carries its reference. */
  goalId?: string;
  submitting: boolean;
  error: string | null;
  onRetry: () => void;
};

/**
 * Offered only once setup has truly not finished: the server says the
 * earlier attempt stalled and its claim expired, and the automatic retries
 * did not get it over the line. No interest question: the answer saved for
 * the goal is reused. Support is one tap away.
 */
export function SavingsGoalRetryPrompt({
  colors,
  goalId,
  submitting,
  error,
  onRetry,
}: Props) {
  return (
    <View style={styles.section}>
      <Text style={[styles.title, { color: colors.text }]}>
        We couldn’t finish setting up your plan
      </Text>
      <Text style={[styles.body, { color: colors.textSecondary }]}>
        This didn’t move any money. Try again, or message us and we’ll sort it
        out.
      </Text>
      {error ? (
        <Text style={[styles.body, { color: colors.error }]}>{error}</Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Try again"
        accessibilityState={{ disabled: submitting }}
        disabled={submitting}
        onPress={onRetry}
        style={[
          styles.submit,
          { backgroundColor: colors.primary },
          submitting ? styles.disabled : null,
        ]}
      >
        <Text style={styles.submitText}>
          {submitting ? 'Trying again…' : 'Try again'}
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel="Message support"
        onPress={() => void openSavingsSupport(goalId)}
        style={styles.support}
      >
        <Text style={[styles.supportText, { color: colors.primary }]}>
          Message support
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 10 },
  title: { fontSize: 14, fontWeight: '700' },
  body: { fontSize: 13, lineHeight: 21 },
  support: { minHeight: 44, justifyContent: 'center', alignItems: 'center' },
  supportText: { fontSize: 13, fontWeight: '600' },
  submit: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  submitText: { color: palette.white, fontWeight: '600' },
  disabled: { opacity: 0.5 },
});
