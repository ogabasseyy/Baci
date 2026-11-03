import * as Crypto from 'expo-crypto';
import { router } from 'expo-router';
import { Alert } from 'react-native';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { addSavingsContribution } from '@/lib/customer-savings';
import { isPiggyvestPrimaryMerchant } from '@/lib/is-piggyvest-primary-merchant';
import { addPiggyvestPrimarySavingsContribution } from '@/lib/piggyvest-primary-savings';
import { cancelSavingsReminderNotification } from '@/services/savings-reminder-notifications';
import { checkPendingPrimarySavings } from './check-pending-primary-savings';
import type { ContributionRail } from './savings/stored-contribution-operation';
import { startSavingsWalletTopUp } from './start-savings-wallet-top-up';
import {
  EARLIER_CONTRIBUTION_CHECKING_MESSAGE,
  planWalletSavingsRail,
} from './wallet-savings-rail';
import { addSavingsContributionToGoal } from './wallet-screen-savings.handlers';

export function createWalletSavingsActions({
  activeMerchantId,
  activeMerchantSlug,
  goal,
  idempotencyKeyRef,
  operationRailRef,
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
  // Rail of the attempt that minted the stored id: same scope as the id,
  // written before each request and cleared together with it.
  operationRailRef: { current: ContributionRail | null };
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

  const releaseOperation = () => {
    idempotencyKeyRef.current = null;
    operationRailRef.current = null;
  };

  const handleAddSavingsContribution = () => {
    const isPrimary = isPiggyvestPrimaryMerchant(activeMerchantId);
    const plan = planWalletSavingsRail({
      hasStoredId: idempotencyKeyRef.current !== null,
      isPrimary,
      storedRail: operationRailRef.current,
    });
    if (plan.kind === 'blocked') {
      // The original rail is no longer available and the id must never move
      // to legacy: keep it and wait.
      Alert.alert('Still checking', EARLIER_CONTRIBUTION_CHECKING_MESSAGE);
      return;
    }
    if (plan.kind === 'check-primary' && idempotencyKeyRef.current) {
      return checkPendingPrimarySavings({
        merchantId: activeMerchantId,
        operationId: idempotencyKeyRef.current,
        clearOperation: releaseOperation,
        clearAmount: () => setSavingsContributionAmount(''),
        refetchWallet,
        setPending: setIsAddingSavingsContribution,
      });
    }
    const rail: ContributionRail =
      plan.kind === 'submit' ? plan.rail : 'primary';
    return addSavingsContributionToGoal({
      activeMerchantId,
      activeMerchantSlug,
      addSavingsContribution:
        rail === 'primary'
          ? addPiggyvestPrimarySavingsContribution
          : addSavingsContribution,
      cancelSavingsReminder: cancelSavingsReminderNotification,
      clearIdempotencyKey: releaseOperation,
      clearSavingsContributionAmount: () => setSavingsContributionAmount(''),
      createIdempotencyKey: () => {
        const key = idempotencyKeyRef.current ?? Crypto.randomUUID();
        idempotencyKeyRef.current = key;
        // Written before the request, so a retry stays on this rail.
        operationRailRef.current = rail;
        return key;
      },
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
