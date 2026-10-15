'use client';

import type { Dispatch, SetStateAction } from 'react';
import { toast } from '@/hooks/use-toast';
import type { UtilityCheckoutResult } from './utility-checkout-submit';
import type { UtilityIdempotencyAttempt } from './use-utility-idempotency-key';
import type { UtilityPurchaseStep } from './use-utility-purchase';
import type { UtilityTabId } from './UtilityTabs';
import { applyUtilityPurchaseBalanceEffect } from './utility-purchase-balance';

type WalletSuccess = Extract<
  UtilityCheckoutResult,
  { kind: 'wallet-success' }
>;

interface UtilityWalletSuccessOutcomeInput {
  activeTab: UtilityTabId;
  appliedReferences: Set<string>;
  attempt: UtilityIdempotencyAttempt | null;
  forgetScopedKey: (scoped: string) => void;
  isScopedReplay: (scoped: string, reference: string) => boolean;
  isScopedStale: (scoped: string, reference: string) => boolean;
  markAttemptShown: (scoped: string | null) => void;
  noteScopedReference: (scoped: string, reference: string) => void;
  clearIntent: () => void;
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
 * Settles + presents a wallet-success checkout result. Extracted from
 * `use-utility-purchase` per the 300-line boundary (Codex R62 6rtokP).
 *
 * Terminal forgets (fresh buy-again); processing keeps (a fresh
 * resubmit would bypass the dedupe row and debit twice). Returns
 * true when the result was a STALE replay (caller stops — the toast
 * already explains buy-again); false otherwise.
 */
export function applyUtilityWalletSuccessOutcome({
  activeTab,
  appliedReferences,
  attempt,
  forgetScopedKey,
  isScopedReplay,
  isScopedStale,
  markAttemptShown,
  noteScopedReference,
  clearIntent,
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
}: UtilityWalletSuccessOutcomeInput): boolean {
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
      forgetScopedKey(scoped);
      toast({
        title: 'Purchase Already Completed',
        description: `This purchase already completed (${result.reference}). Submit again to make a new purchase.`,
        variant: 'destructive',
      });
      setLoading(false);
      return true;
    }
    if (scoped !== undefined) {
      forgetScopedKey(scoped);
    }
  } else {
    if (scoped !== undefined) {
      noteScopedReference(scoped, result.reference);
    }
    refreshWallet();
  }
  clearIntent();
  applyUtilityPurchaseBalanceEffect({
    appliedReferences,
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
  markAttemptShown(scoped ?? null);
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
