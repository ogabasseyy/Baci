import * as Crypto from 'expo-crypto';
import { router } from 'expo-router';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { addSavingsContribution } from '@/lib/customer-savings';
import { isHostedStagingTestPaymentsEnabled } from '@/lib/is-hosted-staging-wallet-top-up-blocked';
import { cancelSavingsReminderNotification } from '@/services/savings-reminder-notifications';
import { addSavingsContributionToGoal } from './wallet-screen-savings.handlers';

export function createWalletSavingsActions({
  activeMerchantId,
  activeMerchantSlug,
  goal,
  idempotencyKeyRef,
  refetchWallet,
  savingsContributionAmount,
  spendableBalance,
  startWalletTopUp,
  setIsAddingSavingsContribution,
  setShowSavingsProgressModal,
  setSavingsContributionAmount,
}: {
  activeMerchantId?: string;
  activeMerchantSlug?: string;
  goal: WalletActiveSavingsGoal | null;
  idempotencyKeyRef: { current: string | null };
  refetchWallet: () => Promise<unknown>;
  savingsContributionAmount: string;
  spendableBalance: number;
  startWalletTopUp: () => void;
  setIsAddingSavingsContribution: (value: boolean) => void;
  setShowSavingsProgressModal: (value: boolean) => void;
  setSavingsContributionAmount: (value: string) => void;
}) {
  const handleOpenSavings = () => {
    if (goal && (goal.status !== 'completed' || goal.selection_unresolved)) {
      setShowSavingsProgressModal(true);
      return;
    }
    router.push('/wallet/savings/start');
  };

  const handleFundSavingsWallet = () => {
    const requestedAmount = Number(savingsContributionAmount);
    if (
      goal?.source_mode !== 'manual' ||
      goal.status === 'completed' ||
      !savingsContributionAmount.trim() ||
      !Number.isSafeInteger(requestedAmount) ||
      requestedAmount <= 0 ||
      requestedAmount > Math.max(0, goal.target_amount - goal.current_amount)
    ) {
      return;
    }
    if (requestedAmount <= spendableBalance) {
      return;
    }
    if (isHostedStagingTestPaymentsEnabled()) {
      router.push({
        pathname: '/savings/funding',
        params: { amount: String(requestedAmount), goalId: goal.id },
      });
      return;
    }
    startWalletTopUp();
  };

  const handleAddSavingsContribution = () =>
    addSavingsContributionToGoal({
      activeMerchantId,
      activeMerchantSlug,
      addSavingsContribution,
      cancelSavingsReminder: cancelSavingsReminderNotification,
      clearIdempotencyKey: () => (idempotencyKeyRef.current = null),
      clearSavingsContributionAmount: () => setSavingsContributionAmount(''),
      createIdempotencyKey: () =>
        (idempotencyKeyRef.current =
          idempotencyKeyRef.current ?? Crypto.randomUUID()),
      goal,
      rawAmount: savingsContributionAmount,
      refetchWallet,
      setIsAddingSavingsContribution,
      walletBalance: spendableBalance,
    });

  return {
    handleAddSavingsContribution,
    handleFundSavingsWallet,
    handleOpenSavings,
  };
}
