import type Colors from '@/constants/Colors';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
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
};

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
}: WalletSavingsFundingSectionProps) {
  const showWalletContribution =
    !usesPlanFunding || goal.source_mode === 'manual';
  if (usesPlanFunding && !visible) {
    return null;
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
