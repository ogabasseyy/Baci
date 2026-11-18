import { useRef } from 'react';
import { isFundedUnsettledGoal } from './savings/goal-settlement';
import { notifySavings } from './savings/savings-notice';
import { usePrimaryGoalGate } from './savings/use-primary-goal-gate';
import { useWalletPinPrompt } from './savings/use-wallet-pin-prompt';
import { usePendingSavingsStatusCheck } from './use-pending-savings-status-check';
import { usePendingSavingsStatusPolling } from './use-pending-savings-status-polling';
import { usePrimarySavingsRecovery } from './use-primary-savings-recovery';
import { createWalletSavingsActions } from './use-wallet-savings-actions';

export function useWalletSavingsController(
  input: Parameters<typeof createWalletSavingsActions>[0] & {
    userId?: string;
    walletUpdatedAt?: number;
  }
) {
  // The pending key belongs to the (user, merchant, goal) scope that
  // created it: the server answers not_found for any other scope (its
  // status read joins the operation to the caller's intent, never
  // leaking existence across identities), so a key that survived a
  // scope change would query — and clear on not_found — a foreign
  // operation id. Drop it synchronously on scope change instead. The
  // recovery hook re-adopts this scope's real server-side operation
  // when enabled; when disabled there is nothing to adopt.
  const boundScope = useRef<string | null>(null);
  const scopeKey = JSON.stringify([
    input.userId,
    input.activeMerchantId,
    input.goal?.id,
  ]);
  if (boundScope.current !== scopeKey) {
    boundScope.current = scopeKey;
    input.idempotencyKeyRef.current = null;
    input.operationRailRef.current = null;
  }
  const recovery = usePrimarySavingsRecovery({
    merchantId: input.activeMerchantId,
    userId: input.userId,
    goalId: input.goal?.id,
    operationRef: input.idempotencyKeyRef,
    railRef: input.operationRailRef,
    setAmount: input.setSavingsContributionAmount,
  });
  const { requestProof, sheetProps: pinSheetProps } = useWalletPinPrompt();
  const gate = usePrimaryGoalGate(input.walletUpdatedAt);
  const goalAwaitingSettlement =
    gate === 'ready' && isFundedUnsettledGoal(input.goal);
  const status = usePendingSavingsStatusCheck({
    goal: input.goal,
    merchantId: input.activeMerchantId,
    idempotencyKeyRef: input.idempotencyKeyRef,
    operationRailRef: input.operationRailRef,
    submittingRef: input.submittingRef,
    refetchWallet: input.refetchWallet,
    setSavingsContributionAmount: input.setSavingsContributionAmount,
  });
  const actions = createWalletSavingsActions({
    ...input,
    checkPendingStatus: status.checkStatus,
    goalAwaitingSettlement,
    goalSettlementChecking:
      (gate === 'checking' || gate === 'error') &&
      isFundedUnsettledGoal(input.goal),
    requestPinProof: requestProof,
  });
  const retryRecovery = () => {
    recovery.retry();
    notifySavings(
      'Checking contributions',
      'We need to check for an existing transfer before starting another payment. Please try again after this check.',
      'info'
    );
  };
  const hasPendingSavingsContribution =
    recovery.ready && actions.hasPendingSavingsContribution;
  // A legacy-rail id is never status-read: its card replays the same add
  // (same id, same rail, same amount), so the amount can't be edited first.
  const legacyRetry = input.operationRailRef.current === 'legacy';
  // Lives with the stored operation, not with the sheet or card on screen.
  usePendingSavingsStatusPolling(
    hasPendingSavingsContribution && !legacyRetry
      ? input.idempotencyKeyRef.current
      : null,
    () => status.checkStatus({ automatic: true })
  );
  return {
    ...actions,
    goalAwaitingSettlement,
    pinSheetProps,
    hasPendingSavingsContribution,
    /** What the wallet content needs to show the savings sheet correctly. */
    walletContentSavingsProps: {
      hasPendingSavingsContribution,
      isCheckingSavingsContribution: status.isCheckingStatus,
      isSavingsContributionRetry: legacyRetry,
      // Primary: a status read only, never the submit path. Legacy: replay.
      onCheckSavingsContribution: legacyRetry
        ? actions.handleAddSavingsContribution
        : status.checkStatus,
      // The card keeps "Complete goal" while the check is running or the
      // server is unreachable (walk 11): the same funded goal never flips to
      // "Start another plan". The sheet still waits for 'ready' to act.
      goalAwaitingSettlement:
        goalAwaitingSettlement ||
        ((gate === 'checking' || gate === 'error') &&
          isFundedUnsettledGoal(input.goal)),
      walletUpdatedAt: input.walletUpdatedAt,
    },
    handleAddSavingsContribution: recovery.ready
      ? actions.handleAddSavingsContribution
      : retryRecovery,
    handleFundSavingsWallet: recovery.ready
      ? actions.handleFundSavingsWallet
      : retryRecovery,
  };
}
