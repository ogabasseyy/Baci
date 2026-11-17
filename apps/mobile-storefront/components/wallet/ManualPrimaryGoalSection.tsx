import { Pressable, StyleSheet, Text, View } from 'react-native';
import { formatNgnCurrency } from '@/lib/format-ngn-currency';
import { SavingsFundingLoadingPanel } from './SavingsFundingLoadingPanel';
import { lastGoalSetupPhase } from './savings/goal-setup-memory';
import { SavingsPlanStatusNote } from './savings/SavingsPlanStatusNote';
import { shownGoalSetupPhase } from './savings/shown-goal-setup-phase';
import { useAutoWalletHeadStart } from './savings/use-auto-wallet-head-start';
import { useGoalWalletSetupPoll } from './savings/use-goal-wallet-setup-poll';
import { useSavingsPlanFunding } from './savings/use-savings-plan-funding';
import { WalletSavingsContributionFlow } from './WalletSavingsContributionFlow';
import type { ManualPrimaryGoalSectionProps } from './wallet-savings-funding-section.types';

/** Phases where the plan is still being set up, not failed. */
const SETTING_UP: readonly string[] = ['idle', 'loading', 'pending'];

/** A manual goal on a confirmed-ready primary wallet. */
export function ManualPrimaryGoalSection(props: ManualPrimaryGoalSectionProps) {
  const { colors, goal, merchantId, userId } = props;
  const scopeKey = JSON.stringify([userId, merchantId, goal.id]);
  const funding = useSavingsPlanFunding({
    activeMerchantId: merchantId,
    goalId: goal.id,
    identityKey: userId,
    loadExisting: true,
    notFoundMeansNotStarted: true,
  });
  // While the status is being read, show what this app last knew about the
  // plan (a plan still getting ready stays on that card), never a live amount
  // entry for a plan whose wallet may not exist yet.
  const phase = shownGoalSetupPhase(funding.planFundingPhase, scopeKey);
  const poll = useGoalWalletSetupPoll({
    phase,
    scopeKey,
    reread: funding.fetchExistingPlanFunding,
    onExhausted: funding.failExistingPlanFunding,
    // Setup starts with the plan, so "slow" counts from its creation.
    pendingSince: goal.created_at ? Date.parse(goal.created_at) : null,
  });
  // A head start the customer ticked "pay now" for: one tap moves exactly
  // that amount once the plan is ready, instead of the amount entry.
  const headStart = useAutoWalletHeadStart({
    goalId: goal.id,
    ready: phase === 'ready',
    addAmount: props.addAmount,
    walletBalance: props.walletBalance,
    remainingAmount: props.remainingAmount,
    onAddAmountChange: props.onAddAmountChange,
    onAddSavings: props.onAddSavings,
  });
  const busy = props.isAdding || props.isFundPending;
  // The one-tap button only when the head start still fits the wallet and
  // the plan; otherwise the normal entry (prefilled with it) shows, which
  // offers a top-up or a smaller amount like any other contribution.
  const oneTap = headStart.waiting !== null && headStart.fits;
  return (
    <>
      {headStart.waiting !== null && SETTING_UP.includes(phase) ? (
        <Text style={[styles.note, { color: colors.textSecondary }]}>
          Your {formatNgnCurrency(headStart.waiting)} head start is ready to
          move from your wallet as soon as your plan is ready.
        </Text>
      ) : headStart.waiting !== null && phase !== 'ready' ? (
        // Setup stalled or unavailable: say the head start is kept, without
        // promising when, next to the status card's own guidance.
        <Text style={[styles.note, { color: colors.textSecondary }]}>
          Your {formatNgnCurrency(headStart.waiting)} head start is saved for
          this plan. You can move it once the plan is set up.
        </Text>
      ) : null}
      <SavingsPlanStatusNote
        colors={colors}
        goalId={goal.id}
        identityKey={userId}
        merchantId={merchantId}
        funding={{ ...funding, planFundingPhase: phase }}
        slow={poll.slow}
        paused={poll.paused}
        onCheckAgain={poll.checkAgain}
      />
      {/* The amount entry shows only once the plan's savings wallet is known
          to be ready (now, or on this app's last read of it). The transfer
          itself is refused server-side until that wallet exists. */}
      {phase === 'ready' && oneTap && headStart.waiting !== null ? (
        <View style={styles.headStart}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Move ${formatNgnCurrency(headStart.waiting)} from my wallet`}
            accessibilityState={{ disabled: busy || !headStart.canMove }}
            disabled={busy || !headStart.canMove}
            onPress={headStart.move}
            style={[
              styles.moveButton,
              { backgroundColor: colors.primary },
              busy || !headStart.canMove ? styles.disabled : null,
            ]}
          >
            <Text
              style={[styles.moveText, { color: colors.primaryForeground }]}
            >
              Move {formatNgnCurrency(headStart.waiting)} from my wallet
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={headStart.dismiss}
            disabled={busy}
          >
            <Text
              style={[
                styles.note,
                styles.center,
                { color: colors.textSecondary },
              ]}
            >
              Choose a different amount
            </Text>
          </Pressable>
        </View>
      ) : phase === 'ready' ? (
        <WalletSavingsContributionFlow
          addAmount={props.addAmount}
          colors={colors}
          isAdding={props.isAdding}
          isFundPending={props.isFundPending}
          onAddAmountChange={props.onAddAmountChange}
          onAddSavings={props.onAddSavings}
          onFundWallet={props.onFundWallet}
          remainingAmount={props.remainingAmount}
          walletBalance={props.walletBalance}
        />
      ) : (phase === 'idle' || phase === 'loading') &&
        lastGoalSetupPhase(scopeKey) === null ? (
        // First read of this plan in this app run: a quiet placeholder.
        <SavingsFundingLoadingPanel colors={colors} />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  note: { fontSize: 13, lineHeight: 18 },
  center: { textAlign: 'center' },
  headStart: { gap: 12 },
  moveButton: { borderRadius: 999, paddingVertical: 16, alignItems: 'center' },
  moveText: { fontSize: 17, fontWeight: '700' },
  disabled: { opacity: 0.5 },
});
