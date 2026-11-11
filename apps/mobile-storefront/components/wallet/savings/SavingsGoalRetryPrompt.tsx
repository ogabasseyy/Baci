import { Pressable, StyleSheet, Text, View } from 'react-native';
import type Colors from '@/constants/Colors';
import { palette } from '@/constants/Colors';

type Props = {
  colors: (typeof Colors)['light'];
  submitting: boolean;
  error: string | null;
  onRetry: () => void;
};

/**
 * Offered only when the server says a goal's earlier setup attempt stalled
 * and its claim expired. No interest question: the answer saved for the goal
 * is reused, so there is nothing to choose or contradict.
 */
export function SavingsGoalRetryPrompt({
  colors,
  submitting,
  error,
  onRetry,
}: Props) {
  return (
    <View style={styles.section}>
      <Text style={[styles.body, { color: colors.textSecondary }]}>
        Setting up this goal did not finish. You can try again; your earlier
        answer about interest is kept.
      </Text>
      {error ? (
        <Text style={[styles.body, { color: colors.error }]}>{error}</Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Try setup again"
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
          {submitting ? 'Setting up…' : 'Try setup again'}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 10 },
  body: { fontSize: 13, lineHeight: 21 },
  submit: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  submitText: { color: palette.white, fontWeight: '600' },
  disabled: { opacity: 0.5 },
});
