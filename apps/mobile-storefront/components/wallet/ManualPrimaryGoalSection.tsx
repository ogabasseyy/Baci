import { SavingsPlanStatusNote } from './savings/SavingsPlanStatusNote';
import { useGoalWalletSetupPoll } from './savings/use-goal-wallet-setup-poll';
import { useSavingsPlanFunding } from './savings/use-savings-plan-funding';
import { WalletSavingsContributionFlow } from './WalletSavingsContributionFlow';
import type { ManualPrimaryGoalSectionProps } from './wallet-savings-funding-section.types';

/** A manual goal on a confirmed-ready primary wallet. */
export function ManualPrimaryGoalSection(props: ManualPrimaryGoalSectionProps) {
  const { colors, goal, merchantId, userId } = props;
  const funding = useSavingsPlanFunding({
    activeMerchantId: merchantId,
    goalId: goal.id,
    identityKey: userId,
    loadExisting: true,
    notFoundMeansNotStarted: true,
  });
  const poll = useGoalWalletSetupPoll({
    phase: funding.planFundingPhase,
    scopeKey: JSON.stringify([userId, merchantId, goal.id]),
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
        funding={funding}
        slow={poll.slow}
        onCheckAgain={poll.checkAgain}
      />
      {/* The form shows at once while the plan's savings wallet is confirmed
          in the background; only a definite "not ready" answer replaces it.
          The transfer itself is refused server-side until that wallet exists. */}
      {funding.planFundingPhase === 'ready' ||
      funding.planFundingPhase === 'idle' ||
      funding.planFundingPhase === 'loading' ? (
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
      ) : null}
    </>
  );
}
