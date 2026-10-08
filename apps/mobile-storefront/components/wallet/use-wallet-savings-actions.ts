import * as Crypto from 'expo-crypto';
import { router } from 'expo-router';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { addSavingsContribution } from '@/lib/customer-savings';
import { isHostedStagingTestPaymentsEnabled } from '@/lib/is-hosted-staging-wallet-top-up-blocked';
import { isPiggyvestPrimaryMerchant } from '@/lib/is-piggyvest-primary-merchant';
import { addPiggyvestPrimarySavingsContribution } from '@/lib/piggyvest-primary-savings';
import { cancelSavingsReminderNotification } from '@/services/savings-reminder-notifications';
import { checkPendingPrimarySavings } from './check-pending-primary-savings';
import { startSavingsWalletTopUp } from './start-savings-wallet-top-up';
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
  walletTopUp,
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
  startWalletTopUp?: () => void;
  walletTopUp?: Pick<
    Parameters<typeof startSavingsWalletTopUp>[0],
    'customer' | 'user' | 'setIsFundPending'
  >;
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
    if (
      isPiggyvestPrimaryMerchant(activeMerchantId) &&
      idempotencyKeyRef.current
    ) {
      return handleAddSavingsContribution();
    }
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
    if (startWalletTopUp) startWalletTopUp();
    else if (walletTopUp)
      void startSavingsWalletTopUp({
        ...walletTopUp,
        activeMerchantId,
        activeMerchantSlug,
        fundAmount: savingsContributionAmount,
        goalId: goal.id,
      });
  };

  const handleAddSavingsContribution = () => {
    if (
      isPiggyvestPrimaryMerchant(activeMerchantId) &&
      idempotencyKeyRef.current
    ) {
      return checkPendingPrimarySavings({
        merchantId: activeMerchantId,
        operationId: idempotencyKeyRef.current,
        clearOperation: () => (idempotencyKeyRef.current = null),
        clearAmount: () => setSavingsContributionAmount(''),
        refetchWallet,
        setPending: setIsAddingSavingsContribution,
      });
    }
    return addSavingsContributionToGoal({
      activeMerchantId,
      activeMerchantSlug,
      addSavingsContribution: isPiggyvestPrimaryMerchant(activeMerchantId)
        ? addPiggyvestPrimarySavingsContribution
        : addSavingsContribution,
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
  };

  return {
    hasPendingSavingsContribution:
      isPiggyvestPrimaryMerchant(activeMerchantId) &&
      idempotencyKeyRef.current !== null,
    handleAddSavingsContribution,
    handleFundSavingsWallet,
    handleOpenSavings,
  };
}
