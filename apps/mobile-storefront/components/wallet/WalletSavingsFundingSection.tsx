import type Colors from '@/constants/Colors';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { CONFIG } from '@/lib/config';
import { pickMerchantId } from '@/lib/pick-merchant-id';
import { useAuthStore } from '@/stores/auth-store';
import { SavingsPlanStatusNote } from './savings/SavingsPlanStatusNote';
import { useGoalWalletSetupPoll } from './savings/use-goal-wallet-setup-poll';
import { usePrimaryGoalGate } from './savings/use-primary-goal-gate';
import { useSavingsPlanFunding } from './savings/use-savings-plan-funding';
import { WalletSavingsContributionFlow } from './WalletSavingsContributionFlow';
import { WalletSavingsPlanFunding } from './WalletSavingsPlanFunding';

type WalletColors = (typeof Colors)['light'];

type WalletSavingsFundingSectionProps = {
  addAmount: string;
  colors: WalletColors;
  goal: WalletActiveSavingsGoal;
  isAdding: boolean;
  isFundPending: boolean;
  onAddAmountChange: (value: string) => void;
  onAddSavings: () => void;
  onFundWallet: () => void;
  onRefreshWallet?: () => Promise<unknown>;
  remainingAmount: number;
  usesPlanFunding: boolean;
  visible: boolean;
  walletBalance: number;
  walletUpdatedAt?: number;
};

type ManualPrimaryGoalProps = WalletSavingsFundingSectionProps & {
  merchantId: string;
  userId: string;
};

/**
 * A manual goal of a customer whose main wallet is ready: the goal's own
 * wallet is asked for (interest answer, then setup) right here, and money can
 * only be added once its status reads ready. One status read feeds both the
 * note and that gate.
 */
function ManualPrimaryGoalSection(props: ManualPrimaryGoalProps) {
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

export function WalletSavingsFundingSection({
  addAmount,
  colors,
  goal,
  isAdding,
  isFundPending,
  onAddAmountChange,
  onAddSavings,
  onFundWallet,
  onRefreshWallet,
  remainingAmount,
  usesPlanFunding,
  visible,
  walletBalance,
  walletUpdatedAt,
}: WalletSavingsFundingSectionProps) {
  const gate = usePrimaryGoalGate(walletUpdatedAt);
  const userId = useAuthStore((state) => state.user?.id);
  const storeMerchantId = useAuthStore((state) => state.merchantId);
  const merchantId = pickMerchantId(storeMerchantId, CONFIG.MERCHANT_ID);
  const showWalletContribution =
    !usesPlanFunding || goal.source_mode === 'manual';
  if (usesPlanFunding && !visible) {
    return null;
  }
  if (!usesPlanFunding && goal.source_mode === 'manual' && gate !== 'off') {
    // Still finding out whether the main wallet is ready: add nothing yet.
    if (gate === 'checking' || !userId || !merchantId) return null;
    return (
      <ManualPrimaryGoalSection
        key={JSON.stringify([userId, merchantId, goal.id])}
        addAmount={addAmount}
        colors={colors}
        goal={goal}
        isAdding={isAdding}
        isFundPending={isFundPending}
        merchantId={merchantId}
        onAddAmountChange={onAddAmountChange}
        onAddSavings={onAddSavings}
        onFundWallet={onFundWallet}
        onRefreshWallet={onRefreshWallet}
        remainingAmount={remainingAmount}
        usesPlanFunding={usesPlanFunding}
        userId={userId}
        visible={visible}
        walletBalance={walletBalance}
      />
    );
  }

  return (
    <>
      {showWalletContribution ? (
        <WalletSavingsContributionFlow
          addAmount={addAmount}
          colors={colors}
          isAdding={isAdding}
          isFundPending={isFundPending}
          onAddAmountChange={onAddAmountChange}
          onAddSavings={onAddSavings}
          onFundWallet={onFundWallet}
          remainingAmount={remainingAmount}
          walletBalance={walletBalance}
        />
      ) : null}
      {usesPlanFunding ? (
        <WalletSavingsPlanFunding
          key={goal.id}
          addAmount={addAmount}
          colors={colors}
          goal={goal}
          onAddAmountChange={onAddAmountChange}
          onRefreshWallet={onRefreshWallet}
        />
      ) : null}
    </>
  );
}
