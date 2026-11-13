import { Pressable, StyleSheet, Text, View } from 'react-native';
import type Colors from '@/constants/Colors';
import { usePiggyvestSlowdown } from '@/hooks/use-piggyvest-slowdown';
import { isPiggyvestPrimaryMerchant } from '@/lib/is-piggyvest-primary-merchant';
import { openSavingsSupport } from './open-savings-support';
import { SavingsGoalRetryPrompt } from './SavingsGoalRetryPrompt';
import { SavingsGoalSetupPrompt } from './SavingsGoalSetupPrompt';
import { SavingsPlanGettingReady } from './SavingsPlanGettingReady';
import { useAutoRetrySetup } from './use-auto-retry-setup';
import { useGoalWalletSetupPoll } from './use-goal-wallet-setup-poll';
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
  /** Set once setup has taken longer than the first minute of checks. */
  slow?: boolean;
  /** Automatic checks have paused (about an hour on screen). */
  paused?: boolean;
  /** Reads status now and restarts the quick checks. */
  onCheckAgain?: () => void;
};

/**
 * Tells a customer whose plan wallet is not ready yet that it is getting
 * ready (calmly: checks keep running and they can leave), and never shows the
 * goal's account number. A goal whose setup never started (confirmed by a
 * finished status read, on a primary merchant with an available verdict)
 * gets the explicit interest question and a setup action; setup is never
 * offered while status is unknown or pending. A pending goal the server flags
 * retryable (its earlier claim expired) is retried automatically with the
 * stored interest answer; only when those tries are used up does the
 * customer see a retry button and a support link.
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
  // Keeps checking a plan that is getting ready, so this screen never stalls.
  const poll = useGoalWalletSetupPoll({
    phase: funding.planFundingPhase,
    scopeKey: JSON.stringify([
      props.identityKey,
      props.merchantId,
      props.goalId,
    ]),
    reread: funding.fetchExistingPlanFunding,
    onExhausted: funding.failExistingPlanFunding,
  });
  return (
    <StatusNoteView
      {...props}
      funding={funding}
      bvnGate
      slow={poll.slow}
      paused={poll.paused}
      onCheckAgain={poll.checkAgain}
    />
  );
}

function StatusNoteView({
  colors,
  goalId,
  identityKey,
  merchantId,
  funding,
  bvnGate = false,
  slow = false,
  paused = false,
  onCheckAgain,
}: Props & { funding: PlanFunding; bvnGate?: boolean }) {
  const primary = isPiggyvestPrimaryMerchant(merchantId);
  const setup = useSavingsGoalSetup({
    goalId,
    merchantId,
    onSettled: () => void funding.fetchExistingPlanFunding(),
  });
  const phase = funding.planFundingPhase;
  const slowdown = usePiggyvestSlowdown();
  const autoRetry = useAutoRetrySetup({
    active: primary && phase === 'setup_retryable',
    // Behind the BVN field (the note's own status read) never retry by
    // itself. A parent that supplies the status shows no BVN field, and
    // goal setup does not need one, so retrying there is safe.
    blocked: bvnGate && funding.planFundingRequiresBvn === true,
    // Same account + merchant + goal key as the poll and setup memory.
    scopeKey: JSON.stringify([identityKey, merchantId, goalId]),
    submitting: setup.submitting,
    retry: setup.retry,
  });
  // The note reads its own status only where a BVN field may be on screen; a
  // parent that supplies the status (no BVN field) controls visibility itself.
  if (!primary || (bvnGate && funding.planFundingRequiresBvn)) return null;
  const rereadingAfterSetup = phase === 'loading' && setup.attempted;
  // A stalled setup is picked up again automatically; the customer sees the
  // calm "getting ready" card until those tries are used up.
  if (
    (phase === 'setup_retryable' || (rereadingAfterSetup && setup.retried)) &&
    autoRetry.exhausted
  )
    return (
      <SavingsGoalRetryPrompt
        colors={colors}
        submitting={setup.submitting || phase === 'loading'}
        error={setup.error}
        onRetry={() => void setup.retry()}
      />
    );
  if (phase === 'setup_retryable' || (rereadingAfterSetup && setup.retried))
    return (
      <SavingsPlanGettingReady
        colors={colors}
        slow={slow}
        paused={paused}
        onCheckNow={
          onCheckAgain ?? (() => void funding.fetchExistingPlanFunding())
        }
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
  // While PiggyVest is slow, a failed check is not alarming news: keep the
  // calm card (the shared notice explains) and keep checking.
  if (phase === 'error' && slowdown)
    return (
      <SavingsPlanGettingReady
        colors={colors}
        slow
        paused={paused}
        onCheckNow={
          onCheckAgain ?? (() => void funding.fetchExistingPlanFunding())
        }
      />
    );
  if (phase === 'error') {
    return (
      <View style={styles.section}>
        <Text style={[styles.body, { color: colors.textSecondary }]}>
          We couldn’t check on your plan just now. Check your connection and try
          again.
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Try again"
          // Restart the full check cycle when the parent runs one.
          onPress={
            onCheckAgain ?? (() => void funding.fetchExistingPlanFunding())
          }
          style={styles.retry}
        >
          <Text style={[styles.action, { color: colors.primary }]}>
            Try again
          </Text>
        </Pressable>
      </View>
    );
  }
  if (phase === 'unavailable')
    return (
      <View style={styles.section}>
        <Text style={[styles.body, { color: colors.textSecondary }]}>
          We can’t finish setting up this plan right now. No money has moved.
        </Text>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel="Message support"
          onPress={() => void openSavingsSupport()}
          style={styles.retry}
        >
          <Text style={[styles.action, { color: colors.primary }]}>
            Message support
          </Text>
        </Pressable>
      </View>
    );
  return (
    <SavingsPlanGettingReady
      colors={colors}
      slow={slow}
      paused={paused}
      // Always reachable: the paused copy points at this button.
      onCheckNow={
        onCheckAgain ?? (() => void funding.fetchExistingPlanFunding())
      }
    />
  );
}

const styles = StyleSheet.create({
  section: { gap: 6 },
  body: { fontSize: 13, lineHeight: 21 },
  action: { fontSize: 13, fontWeight: '500' },
  retry: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
});
