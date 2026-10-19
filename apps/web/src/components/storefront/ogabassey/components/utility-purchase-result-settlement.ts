'use client';

import type { Dispatch, SetStateAction } from 'react';
import { hasUtilityPurchaseIdentityMoved } from '@/contexts/customer-live-identity';
import { toast } from '@/hooks/use-toast';
import type { UtilityCheckoutResult } from './utility-checkout-submit';
import type { UtilityIdempotencyAttempt } from './use-utility-idempotency-key';
import {
  finalizeSuppressedAttempt,
  shouldRotateVtuKeyForStatus,
} from './use-utility-idempotency-key';
import type { UtilityPurchaseStep } from './use-utility-purchase';
import { applyUtilityWalletSuccessOutcome } from './utility-purchase-wallet-success';
import type { UtilityTabId } from './UtilityTabs';

export interface UtilityPurchaseSubmitter {
  customerId: string | null;
  merchantSlug: string | null;
  userId: string | null;
}

export interface SettleUtilityPurchaseResultInput {
  activeTab: UtilityTabId;
  appliedReferences: Set<string>;
  attempt: UtilityIdempotencyAttempt | null;
  clearIntent: () => void;
  forgetScopedKey: (scoped: string) => void;
  isResultViewActive: () => boolean;
  isScopedReplay: (scoped: string, reference: string) => boolean;
  isScopedStale: (scoped: string, reference: string) => boolean;
  markAttemptShown: (scoped: string | null) => void;
  noteScopedReference: (scoped: string, reference: string) => void;
  getCurrentBalance: () => number;
  refreshWallet: () => void;
  result: UtilityCheckoutResult;
  setLoading: Dispatch<SetStateAction<boolean>>;
  setStep: Dispatch<SetStateAction<UtilityPurchaseStep>>;
  setSuccessAmount: Dispatch<SetStateAction<number>>;
  setTransactionRef: Dispatch<SetStateAction<string>>;
  setTransactionVoucherPin: Dispatch<SetStateAction<string | null>>;
  setWalletBalance: Dispatch<SetStateAction<number>>;
  submitAmount: number;
  submitBalance: number;
  submitter: UtilityPurchaseSubmitter;
}

/**
 * Settles a settled checkout response: suppressed-view preserve,
 * mid-flight switch discard (account or storefront), success
 * outcome, or failure handling. Extracted from
 * `use-utility-purchase` per the 300-line boundary (Codex R101 P2).
 */
export async function settleUtilityPurchaseResult({
  activeTab,
  appliedReferences,
  attempt,
  clearIntent,
  forgetScopedKey,
  isResultViewActive,
  isScopedReplay,
  isScopedStale,
  markAttemptShown,
  noteScopedReference,
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
  submitter,
}: SettleUtilityPurchaseResultInput): Promise<void> {
  if (!isResultViewActive()) {
    // Modal closed mid-flight: preserve, don't forget (reopen replays).
    finalizeSuppressedAttempt(attempt, result);
    return;
  }

  // LIVE identity (Codex R95 P1, web mirror of the R94 mobile
  // fix, extended to the storefront by R101 P2): the auth context
  // publishes synchronously at every mutation, so a logout/switch
  // that lands after dispatch but before the next render still
  // discards the stale result here.
  if (hasUtilityPurchaseIdentityMoved(submitter)) {
    // Switched mid-flight (account or storefront): finalize the
    // SUBMITTER's entry, drop the result — the old store's
    // reference/voucher must never publish into the replacement
    // storefront or its wallet.
    finalizeSuppressedAttempt(attempt, result);
    toast({
      title: 'Account changed',
      description:
        'The signed-in account changed while the purchase was processing. The result was discarded.',
    });
    setLoading(false);
    return;
  }

  if (result.kind === 'wallet-success') {
    const stale = await applyUtilityWalletSuccessOutcome({
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
    });
    if (stale) {
      return;
    }
  } else if (result.kind === 'error') {
    // 4xx rotates (fresh retry); pre-route/5xx/unknown keeps (dedupes).
    if (attempt && shouldRotateVtuKeyForStatus(result.status)) {
      forgetScopedKey(attempt.scoped);
    }
    refreshWallet();
    toast({
      title: 'Transaction Failed',
      description: result.message,
      variant: 'destructive',
    });
  }
  setLoading(false);
}
