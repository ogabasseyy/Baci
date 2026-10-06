import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { SavingsPlanCardContributionViewProps } from './SavingsPlanCardContributionView.types';

type Props = Pick<
  SavingsPlanCardContributionViewProps,
  | 'selectedMethod'
  | 'amountKobo'
  | 'amountLabel'
  | 'snapshot'
  | 'reviewing'
  | 'canStart'
  | 'invalidAmount'
  | 'busy'
  | 'onReview'
  | 'onConfirm'
  | 'onCancelReview'
  | 'colors'
>;

export function SavingsCardContributionReview({
  selectedMethod,
  amountKobo,
  amountLabel,
  snapshot,
  reviewing,
  canStart,
  invalidAmount,
  busy,
  onReview,
  onConfirm,
  onCancelReview,
  colors,
}: Props) {
  return (
    <>
      {selectedMethod && amountKobo && !snapshot && !reviewing ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Review card contribution"
          disabled={!canStart || invalidAmount}
          onPress={onReview}
          style={[styles.primary, { backgroundColor: colors.primary }]}
        >
          <Text style={[styles.label, { color: colors.primaryForeground }]}>
            Review contribution
          </Text>
        </Pressable>
      ) : null}
      {reviewing && selectedMethod && amountKobo ? (
        <View style={styles.content}>
          <Text style={[styles.body, { color: colors.text }]}>
            Confirm a one-time charge of {amountLabel} to {selectedMethod.brand}{' '}
            ending in {selectedMethod.last4}. This will not change your savings
            schedule.
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Confirm one-time charge ${amountLabel}`}
            disabled={busy}
            onPress={onConfirm}
            style={[styles.primary, { backgroundColor: colors.primary }]}
          >
            <Text style={[styles.label, { color: colors.primaryForeground }]}>
              Confirm one-time charge
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancel card contribution review"
            onPress={onCancelReview}
          >
            <Text style={[styles.label, { color: colors.textSecondary }]}>
              Cancel
            </Text>
          </Pressable>
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  content: { gap: 12, paddingTop: 10 },
  body: { fontSize: 14, lineHeight: 21 },
  label: { fontSize: 15, fontWeight: '600' },
  primary: {
    minHeight: 50,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
