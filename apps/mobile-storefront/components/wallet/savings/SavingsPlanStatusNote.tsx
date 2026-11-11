import { Pressable, StyleSheet, Text, View } from 'react-native';
import type Colors from '@/constants/Colors';
import { isPiggyvestPrimaryMerchant } from '@/lib/is-piggyvest-primary-merchant';
import { SavingsGoalRetryPrompt } from './SavingsGoalRetryPrompt';
import { SavingsGoalSetupPrompt } from './SavingsGoalSetupPrompt';
import { useSavingsGoalSetup } from './use-savings-goal-setup';
import { useSavingsPlanFunding } from './use-savings-plan-funding';

type PlanFunding = ReturnType<typeof useSavingsPlanFunding>;

type Props = {
  colors: (typeof Colors)['light'];
  goalId: string;
  identityKey: string;
  merchantId: string;
  /**
   * A status hook the parent already runs (so the note and a gate beside it
   * read one status). Without it the note reads its own.
   */
  funding?: PlanFunding;
  /** Set once automatic checks have run out while setup is still pending. */
  onCheckAgain?: () => void;
};

/**
 * Tells a customer whose plan wallet is not ready yet to check back, and
 * never shows the goal's account number. A goal whose setup never started
 * (confirmed by a finished status read, on a primary merchant with an
 * available verdict) also gets the explicit interest question and a setup
 * action; setup is never offered while status is unknown or pending. The
 * one exception is a pending goal the server flags retryable because its
 * earlier claim expired: it gets a retry action that reuses the stored
 * interest answer.
 */
export function SavingsPlanStatusNote(props: Props) {
  return props.funding ? (
    <StatusNoteView {...props} funding={props.funding} />
  ) : (
    <OwnStatusNote {...props} />
  );
}

function OwnStatusNote(props: Props) {
  const funding = useSavingsPlanFunding({
    activeMerchantId: props.merchantId,
    goalId: props.goalId,
    identityKey: props.identityKey,
    loadExisting: isPiggyvestPrimaryMerchant(props.merchantId),
    notFoundMeansNotStarted: true,
  });
  return <StatusNoteView {...props} funding={funding} bvnGate />;
}

function StatusNoteView({
  colors,
  goalId,
  merchantId,
  funding,
  bvnGate = false,
  onCheckAgain,
}: Props & { funding: PlanFunding; bvnGate?: boolean }) {
  const primary = isPiggyvestPrimaryMerchant(merchantId);
  const setup = useSavingsGoalSetup({
    goalId,
    merchantId,
    onSettled: () => void funding.fetchExistingPlanFunding(),
  });
  // The note reads its own status only where a BVN field may be on screen; a
  // parent that supplies the status (no BVN field) controls visibility itself.
  if (!primary || (bvnGate && funding.planFundingRequiresBvn)) return null;
  const phase = funding.planFundingPhase;
  const rereadingAfterSetup = phase === 'loading' && setup.attempted;
  if (phase === 'setup_retryable' || (rereadingAfterSetup && setup.retried))
    return (
      <SavingsGoalRetryPrompt
        colors={colors}
        submitting={setup.submitting || phase === 'loading'}
        error={setup.error}
        onRetry={() => void setup.retry()}
      />
    );
  if (phase === 'not_started' || rereadingAfterSetup)
    return (
      <SavingsGoalSetupPrompt
        colors={colors}
        choice={setup.choice}
        statusReady={phase === 'not_started'}
        submitting={setup.submitting}
        error={setup.error}
        onChoose={setup.setChoice}
        onSubmit={() => void setup.submit()}
      />
    );
  if (phase === 'idle' || phase === 'loading' || phase === 'ready') return null;
  if (phase === 'error') {
    return (
      <View style={styles.section}>
        <Text style={[styles.body, { color: colors.textSecondary }]}>
          We couldn't check this goal's status.
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Try again"
          onPress={() => void funding.fetchExistingPlanFunding()}
          style={styles.retry}
        >
          <Text style={[styles.action, { color: colors.primary }]}>
            Try again
          </Text>
        </Pressable>
      </View>
    );
  }
  if (phase === 'pending' && onCheckAgain) {
    return (
      <View style={styles.section}>
        <Text style={[styles.body, { color: colors.textSecondary }]}>
          Still setting up your goal.
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Check again"
          onPress={onCheckAgain}
          style={styles.retry}
        >
          <Text style={[styles.action, { color: colors.primary }]}>
            Check again
          </Text>
        </Pressable>
      </View>
    );
  }
  return (
    <Text style={[styles.body, { color: colors.textSecondary }]}>
      {phase === 'unavailable'
        ? 'Setup is not available for this goal right now.'
        : 'This goal is still being set up. Please check back shortly.'}
    </Text>
  );
}

const styles = StyleSheet.create({
  section: { gap: 6 },
  body: { fontSize: 13, lineHeight: 21 },
  action: { fontSize: 13, fontWeight: '500' },
  retry: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
});
