import { useState } from 'react';
import { CONFIG } from '@/lib/config';
import { pickMerchantId } from '@/lib/pick-merchant-id';
import { useAuthStore } from '@/stores/auth-store';
import { ManualPrimaryGoalSection } from './ManualPrimaryGoalSection';
import { SavingsFundingLoadingPanel } from './SavingsFundingLoadingPanel';
import { usePrimaryGoalGate } from './savings/use-primary-goal-gate';
import { useWalletPrimaryReady } from './WalletPrimaryContext';
import { WalletSavingsContributionFlow } from './WalletSavingsContributionFlow';
import { WalletSavingsPlanFunding } from './WalletSavingsPlanFunding';
import type { WalletSavingsFundingSectionProps } from './wallet-savings-funding-section.types';

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
  const [gateRetryNonce, setGateRetryNonce] = useState(0);
  // The wallet screen already confirmed the main wallet: use that answer
  // instead of waiting on a second read when the sheet opens.
  const walletPrimaryReady = useWalletPrimaryReady();
  const checkedGate = usePrimaryGoalGate(walletUpdatedAt, gateRetryNonce);
  const gate = walletPrimaryReady ? 'ready' : checkedGate;
  const userId = useAuthStore((state) => state.user?.id);
  const storeMerchantId = useAuthStore((state) => state.merchantId);
  const merchantId = pickMerchantId(storeMerchantId, CONFIG.MERCHANT_ID);
  const showWalletContribution =
    !usesPlanFunding || goal.source_mode === 'manual';
  if (usesPlanFunding && !visible) {
    return null;
  }
  if (!usesPlanFunding && goal.source_mode === 'manual') {
    if (!userId || !merchantId) {
      return <SavingsFundingLoadingPanel colors={colors} state="identity" />;
    }
    if (gate === 'checking')
      return <SavingsFundingLoadingPanel colors={colors} />;
    if (gate === 'error') {
      return (
        <SavingsFundingLoadingPanel
          colors={colors}
          onRetry={() => setGateRetryNonce((nonce) => nonce + 1)}
          state="error"
        />
      );
    }
    if (gate === 'ready')
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
    // Explicit off verdicts keep the legacy contribution path below.
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
