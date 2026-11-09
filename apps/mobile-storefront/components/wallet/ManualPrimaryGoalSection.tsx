import { SavingsFundingLoadingPanel } from './SavingsFundingLoadingPanel';
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
      {funding.planFundingPhase === 'idle' ||
      funding.planFundingPhase === 'loading' ? (
        <SavingsFundingLoadingPanel colors={colors} />
      ) : null}
      <SavingsPlanStatusNote
        colors={colors}
        goalId={goal.id}
        identityKey={userId}
        merchantId={merchantId}
        funding={funding}
        onCheckAgain={poll.exhausted ? poll.checkAgain : undefined}
      />
      {funding.planFundingPhase === 'ready' ? (
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
