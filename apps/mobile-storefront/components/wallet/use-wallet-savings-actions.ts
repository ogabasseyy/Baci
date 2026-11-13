import * as Crypto from 'expo-crypto';
import { router } from 'expo-router';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { addSavingsContribution } from '@/lib/customer-savings';
import { isPiggyvestPrimaryMerchant } from '@/lib/is-piggyvest-primary-merchant';
import { addPiggyvestPrimarySavingsContribution } from '@/lib/piggyvest-primary-savings';
import {
  type PinProofRequester,
  runWithPinProof,
} from '@/lib/wallet-pin-proof';
import { cancelSavingsReminderNotification } from '@/services/savings-reminder-notifications';
import { checkPendingPrimarySavings } from './check-pending-primary-savings';
import { savingsNotifier } from './savings/savings-notice';
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
  goalAwaitingSettlement = false,
  goalSettlementChecking = false,
  idempotencyKeyRef,
  legacyBalance,
  onAddMoney,
  operationRailRef,
  primaryReady = false,
  refetchWallet,
  requestPinProof,
  savingsContributionAmount,
  walletBalance,
  startWalletTopUp,
  walletTopUp,
  setIsAddingSavingsContribution,
  setShowSavingsProgressModal,
  setSavingsContributionAmount,
}: {
  activeMerchantId?: string;
  activeMerchantSlug?: string;
  goal: WalletActiveSavingsGoal | null;
  /** Funded goal the database already marked completed; still completable. */
  goalAwaitingSettlement?: boolean;
  /** A funded completed goal whose readiness verdict is still being read. */
  goalSettlementChecking?: boolean;
  idempotencyKeyRef: { current: string | null };
  /** Legacy-rail balance; defaults to walletBalance when not supplied. */
  legacyBalance?: number;
  /** PiggyVest main wallet ready: opens Add money in place of a card top-up. */
  onAddMoney?: () => void;
  /** True only on an explicit server 'ready' verdict for the main wallet. */
  primaryReady?: boolean;
  // Rail of the attempt that minted the stored id: same scope as the id,
  // written before each request and cleared together with it.
  operationRailRef: { current: ContributionRail | null };
  refetchWallet: () => Promise<unknown>;
  /** Opens the wallet PIN sheet; resolves a single-use proof or null. */
  requestPinProof?: PinProofRequester;
  savingsContributionAmount: string;
  walletBalance: number;
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
    // Neither settle nor start a new plan until the verdict is in.
    if (goalSettlementChecking) return;
    if (
      goal &&
      (goal.status !== 'completed' ||
        goal.selection_unresolved ||
        goalAwaitingSettlement)
    ) {
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
    if (requestedAmount <= walletBalance) {
      return;
    }
    if (primaryReady) {
      // Money comes from the PiggyVest main wallet: never a card payment.
      onAddMoney?.();
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
      // An inline wallet notice, like every other contribution outcome.
      savingsNotifier()(
        'Still checking',
        EARLIER_CONTRIBUTION_CHECKING_MESSAGE,
        'warning'
      );
      return;
    }
    if (plan.kind === 'check-primary' && idempotencyKeyRef.current) {
      return checkPendingPrimarySavings({
        goal,
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
          ? (input) =>
              // A clean "PIN needed" refusal opens the PIN sheet and retries
              // the same stored id on the same rail with the proof.
              runWithPinProof(
                (pinProof) =>
                  addPiggyvestPrimarySavingsContribution({
                    ...input,
                    // The screen showed the PiggyVest balance: never fall back to legacy funds.
                    primaryAdvertised: primaryReady,
                    ...(pinProof ? { pinProof } : {}),
                    // A fallback sends the id on legacy, so retries must follow it.
                    onRail: (sentOn) => {
                      operationRailRef.current = sentOn;
                    },
                  }),
                {
                  merchantId: input.merchantId,
                  goalId: input.goalId,
                  operationId: input.idempotencyKey,
                  amountKobo: Math.round(input.amount * 100),
                },
                requestPinProof
              )
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
      // An id bound to the legacy rail is validated against the legacy balance.
      walletBalance:
        rail === 'primary' ? walletBalance : (legacyBalance ?? walletBalance),
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
