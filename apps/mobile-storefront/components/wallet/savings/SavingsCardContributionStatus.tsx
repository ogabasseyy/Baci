import { Pressable, StyleSheet, Text } from 'react-native';
import type { SavingsPlanCardContributionViewProps } from './SavingsPlanCardContributionView.types';

type Props = Pick<
  SavingsPlanCardContributionViewProps,
  | 'snapshot'
  | 'operationStatus'
  | 'allowRetry'
  | 'busy'
  | 'canStartNew'
  | 'message'
  | 'onCheckStatus'
  | 'onRetry'
  | 'onNewContribution'
  | 'colors'
>;

export function SavingsCardContributionStatus({
  snapshot,
  operationStatus,
  allowRetry,
  busy,
  canStartNew,
  message,
  onCheckStatus,
  onRetry,
  onNewContribution,
  colors,
}: Props) {
  return (
    <>
      {snapshot &&
      (operationStatus === null || operationStatus === 'pending') ? (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Check card contribution status"
            disabled={busy}
            onPress={onCheckStatus}
            style={[styles.secondary, { borderColor: colors.border }]}
          >
            <Text style={[styles.label, { color: colors.text }]}>
              Check status
            </Text>
          </Pressable>
          {allowRetry ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Retry same card contribution request"
              disabled={busy}
              onPress={onRetry}
              style={[styles.secondary, { borderColor: colors.border }]}
            >
              <Text style={[styles.label, { color: colors.text }]}>
                Retry same request
              </Text>
            </Pressable>
          ) : null}
        </>
      ) : null}
      {canStartNew ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Start a new card contribution"
          disabled={busy}
          onPress={onNewContribution}
          style={[styles.secondary, { borderColor: colors.border }]}
        >
          <Text style={[styles.label, { color: colors.text }]}>
            Start a new contribution
          </Text>
        </Pressable>
      ) : null}
      {message ? (
        <Text
          accessibilityLiveRegion="polite"
          style={[styles.body, { color: colors.textSecondary }]}
        >
          {message}
        </Text>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  body: { fontSize: 14, lineHeight: 21 },
  label: { fontSize: 15, fontWeight: '600' },
  secondary: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
