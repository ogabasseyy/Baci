'use client';

import type { Dispatch, SetStateAction } from 'react';
import { toast } from '@/hooks/use-toast';
import type { UtilityCheckoutResult } from './utility-checkout-submit';
import type { UtilityIdempotencyAttempt } from './use-utility-idempotency-key';
import type { UtilityPurchaseStep } from './use-utility-purchase';
import type { UtilityTabId } from './UtilityTabs';
import { forgetPendingVtuPurchaseDurable } from './utility-pending-idempotency';
import { applyUtilityPurchaseBalanceEffect } from './utility-purchase-balance';
import { isCurrentVtuGeneration } from './utility-pending-vtu-sync';

type WalletSuccess = Extract<
  UtilityCheckoutResult,
  { kind: 'wallet-success' }
>;

interface UtilityWalletSuccessOutcomeInput {
  activeTab: UtilityTabId;
  appliedReferences: Set<string>;
  attempt: UtilityIdempotencyAttempt | null;
  isScopedReplay: (scoped: string, reference: string) => boolean;
  isScopedStale: (scoped: string, reference: string) => boolean;
  markAttemptShown: (scoped: string | null, key?: string) => void;
  noteScopedReference: (scoped: string, reference: string) => void;
  clearIntent: () => void;
  getCurrentBalance: () => number;
  refreshWallet: () => void;
  result: WalletSuccess;
  setLoading: Dispatch<SetStateAction<boolean>>;
  setStep: Dispatch<SetStateAction<UtilityPurchaseStep>>;
  setSuccessAmount: Dispatch<SetStateAction<number>>;
  setTransactionRef: Dispatch<SetStateAction<string>>;
  setTransactionVoucherPin: Dispatch<SetStateAction<string | null>>;
  setWalletBalance: Dispatch<SetStateAction<number>>;
  submitAmount: number;
  submitBalance: number;
}

/**
 * Generation-bound terminal forget (Codex P1, mobile
 * forgetOwnPendingVtuPurchaseDurable mirror): a delayed K1
 * terminal response must not delete a newer K2 minted after
 * this submit — K2's lost-response retry would mint K3 and
 * debit again. Skips the mutation when this attempt is no
 * longer current; presentation still shows the real result.
 */
async function forgetCurrentVtuGeneration(
  scoped: string,
  key: string | undefined
): Promise<void> {
  if (key !== undefined && isCurrentVtuGeneration(scoped, key)) {
    await forgetPendingVtuPurchaseDurable(scoped);
  }
}

/**
 * Settles + presents a wallet-success checkout result. Extracted from
 * `use-utility-purchase` per the 300-line boundary (Codex R62 6rtokP).
 *
 * Terminal forgets (fresh buy-again); processing keeps (a fresh
 * resubmit would bypass the dedupe row and debit twice). Returns
 * true when the result was a STALE replay (caller stops — the toast
 * already explains buy-again); false otherwise. Async: terminal
 * forgets are durable-awaited (Codex R153 P2) so the deletion lands
 * before the success view finalizes.
 */
export async function applyUtilityWalletSuccessOutcome({
  activeTab,
  appliedReferences,
  attempt,
  isScopedReplay,
  isScopedStale,
  markAttemptShown,
  noteScopedReference,
  clearIntent,
  getCurrentBalance,
  refreshWallet,
  result,
  setLoading,
  setStep,
  setSuccessAmount,
  setTransactionRef,
  setTransactionVoucherPin,
  setWalletBalance,
  submitAmount,
  submitBalance,
}: UtilityWalletSuccessOutcomeInput): Promise<boolean> {
  // Terminal forgets (fresh buy-again); processing keeps (a fresh
  // resubmit would bypass the dedupe row and debit twice). Refresh
  // instead of decrementing: a stale HIGH balance would pass the
  // underfunded pre-check for a purchase the server rejects.
  const scoped = attempt?.scoped;
  const replayResolvesProcessing =
    !result.processing &&
    scoped !== undefined &&
    isScopedReplay(scoped, result.reference);
  if (!result.processing) {
    if (scoped !== undefined && isScopedStale(scoped, result.reference)) {
      // Stale replay answers a NEW intent with the old vend: forget so
      // the next tap mints fresh, and say so.
      await forgetCurrentVtuGeneration(scoped, attempt?.key);
      toast({
        title: 'Purchase Already Completed',
        description: `This purchase already completed (${result.reference}). Submit again to make a new purchase.`,
        variant: 'destructive',
      });
      setLoading(false);
      return true;
    }
    if (scoped !== undefined) {
      await forgetCurrentVtuGeneration(scoped, attempt?.key);
    }
  } else {
    // Generation veto (Codex P1): skip the note when a sibling tab
    // persisted a newer generation — noting on the stale entry
    // would flush it back over the newer key. The veto adopts the
    // newer generation into memory.
    if (
      scoped !== undefined &&
      attempt?.key !== undefined &&
      isCurrentVtuGeneration(scoped, attempt.key)
    ) {
      noteScopedReference(scoped, result.reference);
    }
    refreshWallet();
  }
  clearIntent();
  applyUtilityPurchaseBalanceEffect({
    appliedReferences,
    getCurrentBalance,
    // Recalled key ⇒ identical submit already went out: ambiguous.
    isAmbiguousReplay:
      replayResolvesProcessing ||
      (!result.processing && attempt?.recalled === true),
    refreshWallet,
    result,
    setWalletBalance,
    submitAmount,
    submitBalance,
  });
  setTransactionRef(result.reference);
  markAttemptShown(scoped ?? null, attempt?.key);
  setSuccessAmount(result.amount);
  setTransactionVoucherPin(result.voucherPin ?? null);
  // A 202 can still fail or be refunded: never the success screen.
  setStep(result.processing ? 'processing' : 'success');
  toast({
    title: result.processing ? 'Purchase Processing' : 'Purchase Successful',
    description: result.processing
      ? `Your ${activeTab} purchase is processing.`
      : `Your ${activeTab} purchase was successful!`,
  });
  return false;
}
