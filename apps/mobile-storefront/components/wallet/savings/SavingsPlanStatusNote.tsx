import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type Colors from '@/constants/Colors';
import { usePiggyvestSlowdown } from '@/hooks/use-piggyvest-slowdown';
import { isPiggyvestPrimaryMerchant } from '@/lib/is-piggyvest-primary-merchant';
import { openSavingsSupport } from './open-savings-support';
import { SavingsGoalRetryPrompt } from './SavingsGoalRetryPrompt';
import { SavingsGoalSetupPrompt } from './SavingsGoalSetupPrompt';
import { SavingsPlanCheckFailed } from './SavingsPlanCheckFailed';
import { SavingsPlanGettingReady } from './SavingsPlanGettingReady';
import { useAutoRetrySetup } from './use-auto-retry-setup';
import { useGoalWalletSetupPoll } from './use-goal-wallet-setup-poll';
import { useResumeGoalSetup } from './use-resume-goal-setup';
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
  /** Reads status now and restarts the quick checks (settles with the read). */
  onCheckAgain?: () => Promise<unknown>;
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
  // The customer tapped Try again (not an automatic retry).
  const [manualRetried, setManualRetried] = useState(false);
  // The customer picked an answer on the prompt themselves: a saved answer
  // that finishes loading later must never replace it.
  const [customerChose, setCustomerChose] = useState(false);
  const phase = funding.planFundingPhase;
  const slowdown = usePiggyvestSlowdown();
  const autoRetry = useAutoRetrySetup({
    active: primary && phase === 'setup_retryable',
    // Only the note's own status read sits beside a BVN field (the staging
    // plan-funding path), so only there does a BVN flag stop the automatic
    // retry. A parent that supplies the status (the wallet sheet) shows no
    // BVN field, and PiggyVest goal setup never needs a BVN, so a stale
    // flag there must not block a retry.
    blocked: bvnGate && funding.planFundingRequiresBvn === true,
    // Same account + merchant + goal key as the poll and setup memory.
    scopeKey: JSON.stringify([identityKey, merchantId, goalId]),
    submitting: setup.submitting,
    retry: setup.retry,
  });
  // A plan whose first setup start never landed is finished with the form's
  // answer, so the customer is not asked again.
  const resume = useResumeGoalSetup({
    active: primary,
    goalId,
    phase,
    failed: setup.error !== null,
    attempted: setup.attempted || customerChose,
    setChoice: setup.setChoice,
    submit: setup.submit,
  });
  // The note reads its own status only where a BVN field may be on screen; a
  // parent that supplies the status (no BVN field) controls visibility itself.
  if (!primary || (bvnGate && funding.planFundingRequiresBvn)) return null;
  const rereadingAfterSetup = phase === 'loading' && setup.attempted;
  // A stalled setup is picked up again automatically; the customer sees the
  // calm "getting ready" card until those tries are used up and the last
  // one (with its status re-read) has come back still stalled. After the
  // customer's own Try again, the prompt stays (disabled) while it re-reads.
  if (
    autoRetry.exhausted &&
    !autoRetry.inFlight &&
    (phase === 'setup_retryable' ||
      (rereadingAfterSetup && setup.retried && manualRetried))
  )
    return (
      <SavingsGoalRetryPrompt
        colors={colors}
        goalId={goalId}
        submitting={setup.submitting || phase === 'loading'}
        error={setup.error}
        onRetry={() => {
          setManualRetried(true);
          void setup.retry();
        }}
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
  if ((phase === 'not_started' || rereadingAfterSetup) && resume.resuming)
    return <SavingsPlanGettingReady colors={colors} />;
  if (phase === 'not_started' || rereadingAfterSetup)
    return (
      <SavingsGoalSetupPrompt
        colors={colors}
        choice={setup.choice}
        statusReady={phase === 'not_started'}
        submitting={setup.submitting}
        error={setup.error}
        onChoose={(answer) => {
          setCustomerChose(true);
          setup.setChoice(answer);
        }}
        onSubmit={() => void setup.submit()}
      />
    );
  if (phase === 'idle' || phase === 'loading' || phase === 'ready') return null;
  // While PiggyVest is slow, a failed check is not alarming news: keep the
  // calm card (the shared notice explains) and keep checking.
  // The same while this note's own checks are still running past their
  // first minute (its last quick read failed): they have not given up.
  if (phase === 'error' && (slowdown || slow))
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
  if (phase === 'error')
    return (
      <SavingsPlanCheckFailed
        colors={colors}
        // Restart the full check cycle when the parent runs one.
        onTryAgain={onCheckAgain ?? (() => funding.fetchExistingPlanFunding())}
      />
    );
  if (phase === 'unavailable')
    return (
      <View style={styles.section}>
        <Text style={[styles.body, { color: colors.textSecondary }]}>
          We can’t finish setting up this plan right now. This didn’t move any
          money.
        </Text>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel="Message support"
          onPress={() => void openSavingsSupport(goalId)}
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
