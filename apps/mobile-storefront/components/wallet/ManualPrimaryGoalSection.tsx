import { SavingsFundingLoadingPanel } from './SavingsFundingLoadingPanel';
import { lastGoalSetupPhase } from './savings/goal-setup-memory';
import { SavingsPlanStatusNote } from './savings/SavingsPlanStatusNote';
import { shownGoalSetupPhase } from './savings/shown-goal-setup-phase';
import { useGoalWalletSetupPoll } from './savings/use-goal-wallet-setup-poll';
import { useSavingsPlanFunding } from './savings/use-savings-plan-funding';
import { WalletSavingsContributionFlow } from './WalletSavingsContributionFlow';
import type { ManualPrimaryGoalSectionProps } from './wallet-savings-funding-section.types';

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
  });
  return (
    <>
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
      {phase === 'ready' ? (
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
