import * as Crypto from 'expo-crypto';
import { router } from 'expo-router';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { addSavingsContribution } from '@/lib/customer-savings';
import { isHostedStagingTestPaymentsEnabled } from '@/lib/is-hosted-staging-wallet-top-up-blocked';
import { isPiggyvestPrimaryMerchant } from '@/lib/is-piggyvest-primary-merchant';
import { addPiggyvestPrimarySavingsContribution } from '@/lib/piggyvest-primary-savings';
import { cancelSavingsReminderNotification } from '@/services/savings-reminder-notifications';
import { trackSavingsContribution } from '@/services/track-savings-contribution';
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
  const refreshGoal = async () => {
    const refreshed = await refetchWallet();
    if (
      typeof refreshed !== 'object' ||
      refreshed === null ||
      !('data' in refreshed)
    )
      return null;
    const data = refreshed.data as
      | import('@/hooks/wallet-query').WalletQueryData
      | undefined;
    return (
      data?.wallet.savings_goals?.find((item) => item.id === goal?.id) ??
      (data?.wallet.active_savings_goal?.id === goal?.id
        ? (data?.wallet.active_savings_goal ?? null)
        : null)
    );
  };
  const handleOpenSavings = () => {
    if (goal && (goal.status !== 'completed' || goal.selection_unresolved)) {
      setShowSavingsProgressModal(true);
      return;
    }
    router.push('/wallet/savings/start');
  };

  const handleFundSavingsWallet = () => {
    const requestedAmount = Number(savingsContributionAmount);
    const isPrimaryWallet = isPiggyvestPrimaryMerchant(activeMerchantId);
    const hasRequestedAmount = savingsContributionAmount.trim().length > 0;

    if (isPrimaryWallet) {
      if (
        goal?.source_mode !== 'manual' ||
        goal.status === 'completed' ||
        (hasRequestedAmount &&
          (!Number.isSafeInteger(requestedAmount) ||
            requestedAmount <= 0 ||
            requestedAmount >
              Math.max(0, goal.target_amount - goal.current_amount)))
      ) {
        return;
      }
      if (hasRequestedAmount && requestedAmount <= spendableBalance) return;
      router.setParams({
        action: 'bank-transfer',
        intent: Crypto.randomUUID(),
        requiredAmount: hasRequestedAmount
          ? String(requestedAmount - Math.max(0, spendableBalance))
          : undefined,
        returnTo: `/wallet?action=savings&savingsGoalId=${encodeURIComponent(goal.id)}&savingsAmount=${encodeURIComponent(savingsContributionAmount)}`,
      });
      return;
    }

    if (
      goal?.source_mode !== 'manual' ||
      goal.status === 'completed' ||
      !hasRequestedAmount ||
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
        refetchWalletBalance: refetchWallet,
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
        goal,
        refreshGoal,
        clearOperation: () => (idempotencyKeyRef.current = null),
        clearAmount: () => setSavingsContributionAmount(''),
        refetchWallet,
        setPending: setIsAddingSavingsContribution,
      });
    }
    return addSavingsContributionToGoal({
      activeMerchantId,
      activeMerchantSlug,
      addSavingsContribution: (request) => {
        const submit = isPiggyvestPrimaryMerchant(activeMerchantId)
          ? addPiggyvestPrimarySavingsContribution
          : addSavingsContribution;
        return goal
          ? trackSavingsContribution(goal, () => submit(request), refreshGoal)
          : submit(request);
      },
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
