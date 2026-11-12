import { Pressable, StyleSheet, Text } from 'react-native';
import type Colors from '@/constants/Colors';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import type { GoalActionKind } from '@/schemas/goal-lifecycle';
import { GOAL_LIFECYCLE_COPY } from './use-goal-lifecycle';
import { usePrimaryGoalGate } from './use-primary-goal-gate';

type Props = {
  colors: (typeof Colors)['light'];
  goal: WalletActiveSavingsGoal;
  hasPendingContribution: boolean;
  /** Opens the in-sheet Cancel step. */
  onCancel: () => void;
  /** Opens the in-sheet Complete step. */
  onComplete: () => void;
  /** The wallet's last-updated time: re-reads the readiness gate. */
  walletUpdatedAt?: number;
};

// The database compares maturity against the UTC date, so the button must too.
function utcToday() {
  return new Date().toISOString().slice(0, 10);
}

// Only an eligible-looking goal gets the button; the server and database make
// the final call and their message is shown if they disagree.
function looksCompletable(goal: WalletActiveSavingsGoal) {
  if (goal.status === 'completed') return true;
  if (goal.current_amount >= goal.target_amount) return true;
  const day = /^\d{4}-\d{2}-\d{2}/.exec(goal.maturity_date ?? '')?.[0];
  return day !== undefined && day <= utcToday();
}

/**
 * Cancel / Complete buttons for a savings goal. Self-gating: nothing renders
 * unless the server has said this customer's main wallet is ready, and never
 * while a contribution is still pending.
 */
export function GoalLifecycleEntry({
  colors,
  goal,
  hasPendingContribution,
  onCancel,
  onComplete,
  walletUpdatedAt,
}: Props) {
  const gate = usePrimaryGoalGate(walletUpdatedAt);
  if (gate !== 'ready' || hasPendingContribution) return null;
  const kinds: GoalActionKind[] = [];
  if (goal.status === 'active' || goal.status === 'paused')
    kinds.push('cancel');
  if (looksCompletable(goal)) kinds.push('complete');
  return (
    <>
      {kinds.map((kind) => (
        <Pressable
          key={kind}
          accessibilityRole="button"
          accessibilityLabel={GOAL_LIFECYCLE_COPY[kind].entryLabel}
          onPress={kind === 'cancel' ? onCancel : onComplete}
          style={
            kind === 'cancel'
              ? styles.quietLink
              : [styles.button, { borderColor: colors.border }]
          }
        >
          <Text
            style={
              kind === 'cancel'
                ? [styles.quietText, { color: colors.textSecondary }]
                : [styles.text, { color: colors.text }]
            }
          >
            {GOAL_LIFECYCLE_COPY[kind].entryButton}
          </Text>
        </Pressable>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 16,
  },
  text: { fontSize: 13, fontWeight: '600' },
  // Cancelling is available but deliberately quiet: a text link, not a button.
  quietLink: {
    alignItems: 'center',
    alignSelf: 'center',
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 16,
  },
  quietText: { fontSize: 12, textDecorationLine: 'underline' },
});
