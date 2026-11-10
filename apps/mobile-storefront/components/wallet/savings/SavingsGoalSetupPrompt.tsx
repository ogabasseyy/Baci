import { Pressable, StyleSheet, Text, View } from 'react-native';
import type Colors from '@/constants/Colors';
import { palette } from '@/constants/Colors';

type Props = {
  colors: (typeof Colors)['light'];
  choice: boolean | null;
  /** True once the status read has finished and says "not started". */
  statusReady: boolean;
  submitting: boolean;
  error: string | null;
  onChoose: (value: boolean) => void;
  onSubmit: () => void;
};

const OPTIONS = [
  { value: true, label: 'Yes, earn interest' },
  { value: false, label: 'No, do not earn interest' },
] as const;

/**
 * The explicit interest question for a goal that was never set up. Neither
 * answer is preselected, and "Set up this goal" stays disabled until the
 * status read has finished and the customer has chosen.
 */
export function SavingsGoalSetupPrompt({
  colors,
  choice,
  statusReady,
  submitting,
  error,
  onChoose,
  onSubmit,
}: Props) {
  const disabled = !statusReady || choice === null || submitting;
  return (
    <View style={styles.section}>
      <Text style={[styles.question, { color: colors.text }]}>
        Earn interest on this goal?
      </Text>
      <Text style={[styles.body, { color: colors.textSecondary }]}>
        This goal has not been set up yet. Your answer is saved for this goal.
      </Text>
      <View accessibilityRole="radiogroup" style={styles.options}>
        {OPTIONS.map((option) => (
          <Pressable
            key={option.label}
            accessibilityRole="radio"
            accessibilityLabel={option.label}
            accessibilityState={{
              checked: choice === option.value,
              disabled: submitting,
            }}
            disabled={submitting}
            onPress={() => onChoose(option.value)}
            style={[
              styles.option,
              {
                borderColor:
                  choice === option.value ? colors.primary : colors.border,
              },
            ]}
          >
            <Text style={{ color: colors.text }}>{option.label}</Text>
          </Pressable>
        ))}
      </View>
      {error ? (
        <Text style={[styles.body, { color: colors.error }]}>{error}</Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Set up this goal"
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onSubmit}
        style={[
          styles.submit,
          { backgroundColor: colors.primary },
          disabled ? styles.disabled : null,
        ]}
      >
        <Text style={styles.submitText}>
          {submitting ? 'Setting up…' : 'Set up this goal'}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 10 },
  question: { fontSize: 14, fontWeight: '600' },
  body: { fontSize: 13, lineHeight: 21 },
  options: { gap: 8 },
  option: {
    minHeight: 44,
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
  },
  submit: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  submitText: { color: palette.white, fontWeight: '600' },
  disabled: { opacity: 0.5 },
});
