import { useRef } from 'react';
import { isFundedUnsettledGoal } from './savings/goal-settlement';
import { notifySavings } from './savings/savings-notice';
import { usePrimaryGoalGate } from './savings/use-primary-goal-gate';
import { useWalletPinPrompt } from './savings/use-wallet-pin-prompt';
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
  const actions = createWalletSavingsActions({
    ...input,
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
  return {
    ...actions,
    goalAwaitingSettlement,
    pinSheetProps,
    hasPendingSavingsContribution,
    /** What the wallet content needs to show the savings sheet correctly. */
    walletContentSavingsProps: {
      hasPendingSavingsContribution,
      goalAwaitingSettlement,
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
