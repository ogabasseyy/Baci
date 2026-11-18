import { Pressable, StyleSheet, Text, View } from 'react-native';
import type Colors from '@/constants/Colors';
import { BRAND, palette } from '@/constants/Colors';
import { SavingsChoiceCards } from './SavingsChoiceCards';

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
  {
    value: true,
    label: 'Yes',
    accessibilityLabel: 'Yes, earn interest',
  },
  {
    value: false,
    label: 'No',
    accessibilityLabel: 'No, do not earn interest',
  },
] as const;

/**
 * The interest question for a plan that was never set up (older plans; new
 * plans answer it on the form). Neither answer is preselected, and "Finish
 * setting up" stays disabled until the status read has finished and the
 * customer has chosen.
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
        Earn interest on this plan?
      </Text>
      <Text style={[styles.body, { color: colors.textSecondary }]}>
        One last thing before you can add money. You can only choose once.
      </Text>
      <SavingsChoiceCards
        accessibilityLabel="Earn interest on this plan"
        colors={colors}
        disabled={submitting}
        options={OPTIONS}
        selected={choice}
        onSelect={onChoose}
      />
      {error ? (
        <Text style={[styles.body, { color: colors.error }]}>{error}</Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Finish setting up"
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onSubmit}
        style={[
          styles.submit,
          { backgroundColor: disabled ? palette.gray[300] : BRAND.primary },
        ]}
      >
        <Text style={styles.submitText}>
          {submitting ? 'Setting up…' : 'Finish setting up'}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 10 },
  question: { fontSize: 14, fontWeight: '600' },
  body: { fontSize: 13, lineHeight: 21 },
  submit: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
  },
  submitText: { color: palette.white, fontWeight: '600' },
});
