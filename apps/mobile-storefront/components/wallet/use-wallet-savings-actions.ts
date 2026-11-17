import * as Crypto from 'expo-crypto';
import { router } from 'expo-router';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { addSavingsContribution } from '@/lib/customer-savings';
import { isPiggyvestPrimaryMerchant } from '@/lib/is-piggyvest-primary-merchant';
import { wasPiggyvestLastRuledOut } from '@/lib/piggyvest-primary-capability-cache';
import { addPiggyvestPrimarySavingsContribution } from '@/lib/piggyvest-primary-savings';
import { readPiggyvestCapabilityNow } from '@/lib/read-piggyvest-capability-now';
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

const WALLET_RECLASSIFYING_MESSAGE =
  'Your wallet is updating. Try again in a moment.';

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
  submittingRef = { current: false },
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
  /**
   * True while this screen's own add is in flight: the operation id it just
   * stored is not an earlier pending contribution (same scope as the id).
   */
  submittingRef?: { current: boolean };
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
    // A live ruling-out picks legacy for a new contribution (Codex): the
    // wallet shows legacy funds then, so the rail must match. A stored
    // PiggyVest id is still kept, never moved (planWalletSavingsRail).
    const isPrimary =
      isPiggyvestPrimaryMerchant(activeMerchantId) &&
      readPiggyvestCapabilityNow(activeMerchantId) !== false;
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
      // A check answers only for the operation it started with. If the
      // stored id changed meanwhile (another account, merchant or goal took
      // over the screen), its late answer must not clear that newer
      // operation, its amount or its busy flag.
      const operationId = idempotencyKeyRef.current;
      let released = false;
      let pendingSet = false;
      const ours = () => idempotencyKeyRef.current === operationId;
      return checkPendingPrimarySavings({
        goal,
        merchantId: activeMerchantId,
        operationId,
        clearOperation: () => {
          if (!ours()) return;
          released = true;
          releaseOperation();
        },
        clearAmount: () => {
          if (released || ours()) setSavingsContributionAmount('');
        },
        refetchWallet,
        // Busy is only ever set while this check still owns the operation,
        // and that busy flag also blocks any new contribution; so the check
        // always clears the flag it set, even after a scope change.
        setPending: (value) => {
          if (value && !ours()) return;
          if (value) pendingSet = true;
          else if (!pendingSet) return;
          setIsAddingSavingsContribution(value);
        },
      });
    }
    // PiggyVest confirmed but not yet reclassified, or unknown after a
    // ruling-out expired while the balance stays suppressed (Codex): the rail
    // would debit an unseen PiggyVest balance against an amount checked on
    // legacy funds. Hold a new contribution and reload. (A pilot with no
    // verdict yet keeps its server-side fallback.)
    const verdictNow = readPiggyvestCapabilityNow(activeMerchantId);
    if (
      plan.kind === 'submit' &&
      idempotencyKeyRef.current === null &&
      !primaryReady &&
      (verdictNow === true ||
        (plan.rail === 'primary' &&
          !!activeMerchantId &&
          wasPiggyvestLastRuledOut(activeMerchantId)))
    ) {
      savingsNotifier()(
        'Still checking',
        WALLET_RECLASSIFYING_MESSAGE,
        'warning'
      );
      void refetchWallet?.();
      return;
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
      // Marked in the same call that re-renders the sheet, so the render that
      // ends the add already knows whether its id is left unresolved.
      setIsAddingSavingsContribution: (value: boolean) => {
        submittingRef.current = value;
        setIsAddingSavingsContribution(value);
      },
      // An id bound to the legacy rail is validated against the legacy balance.
      walletBalance:
        rail === 'primary' ? walletBalance : (legacyBalance ?? walletBalance),
    });
  };

  return {
    hasPendingSavingsContribution:
      isPiggyvestPrimaryMerchant(activeMerchantId) &&
      idempotencyKeyRef.current !== null &&
      !submittingRef.current,
    handleAddSavingsContribution,
    handleFundSavingsWallet,
    handleOpenSavings,
  };
}
