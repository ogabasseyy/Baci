'use client';

import { useEffect, useRef } from 'react';
import type { UtilityCheckoutResult } from './utility-checkout-submit';
import {
  forgetPendingVtuPurchase,
  getPendingVtuKey,
  hasNotedPendingVtuReference,
  isStalePendingVtuSuccess,
  markPendingVtuCompleted,
  notePendingVtuReference,
  recallPendingVtuKey,
  scopePendingVtuSignature,
} from './utility-pending-idempotency';

interface UseUtilityIdempotencyKeyInput {
  customerId?: string;
  merchantId?: string;
  userId?: string;
}

/**
 * One submission's key material, captured when the key is issued. Callers
 * hold this across the async submit and pass `scoped` back explicitly, so
 * a concurrent second submit (or a mid-flight account switch) can never
 * redirect this attempt's completion onto another entry.
 */
export interface UtilityIdempotencyAttempt {
  key: string;
  scoped: string;
  /** True when the key reuses a previously-submitted identical purchase. */
  recalled: boolean;
}

interface UseUtilityIdempotencyKeyResult {
  captureAttemptKey: (
    payloadSignature: string
  ) => UtilityIdempotencyAttempt;
  forgetScopedKey: (scoped: string) => void;
  isResultViewActive: () => boolean;
  isScopedReplay: (scoped: string, reference: string) => boolean;
  isScopedStale: (scoped: string, reference: string) => boolean;
  markAttemptShown: (scoped: string | null) => void;
  noteScopedReference: (scoped: string, reference: string) => void;
  settleShownAttempt: () => void;
}

/**
 * Statuses emitted before the checkout handler runs: the proxy security
 * stage (429 rate limit, 413 payload, 415 content, 403 guard) and the
 * in-route auth/CSRF guards (401/403). No outcome is recorded for
 * these, so the key must be kept — rotating after a 429 retry would
 * mint a fresh key for an already-committed attempt and debit twice.
 * Mirrors mobile's shouldRotateWalletIdempotencyKeyForError carve-out.
 */
const PRE_ROUTE_NO_ROTATION_STATUSES: ReadonlySet<number> = new Set([
  401, 403, 413, 415, 429,
]);

/**
 * True when an error status proves the attempt terminal: a definitive
 * route response (validation, insufficient balance, key collision, …)
 * whose outcome the server recorded under this key. Pre-route
 * 401/403/413/415/429 responses, 5xx, and missing statuses stay
 * ambiguous — keep the key so the retry dedupes.
 */
export function shouldRotateVtuKeyForStatus(status: unknown): boolean {
  return (
    typeof status === 'number' &&
    status >= 400 &&
    status < 500 &&
    !PRE_ROUTE_NO_ROTATION_STATUSES.has(status)
  );
}

/**
 * Finalizes a settled attempt whose result UI is suppressed — the
 * owner switched mid-flight or the modal unmounted before the
 * response arrived. Success (terminal AND processing) is PRESERVED:
 * the charge committed while the UI was suppressed, so the repeat
 * must replay the original outcome — forgetting would mint a fresh
 * key and debit/vend a second time. A genuinely new intent stays
 * safe via the stale-success guard ("Purchase Already Completed").
 * Terminal observations also record completion (processing notes
 * don't), so the guard keys off completion time. Status-bearing
 * terminal errors forget the key — otherwise the retained key
 * replays the dead transaction when they retry. Ambiguous errors
 * keep the key so the retry dedupes.
 */
export function finalizeSuppressedAttempt(
  attempt: UtilityIdempotencyAttempt | null,
  result: UtilityCheckoutResult
): void {
  if (!attempt) {
    return;
  }
  if (result.kind === 'wallet-success') {
    notePendingVtuReference(attempt.scoped, result.reference);
    // Terminal observations also record completion (processing notes
    // must NOT): the stale predicate keys off completion time, so a
    // switch-back repeat minutes later presents this vend instead of
    // misreporting it as "Already Completed".
    if (!result.processing) {
      markPendingVtuCompleted(attempt.scoped);
    }
  } else if (
    result.kind === 'error' &&
    shouldRotateVtuKeyForStatus(result.status)
  ) {
    forgetPendingVtuPurchase(attempt.scoped);
  }
}

/**
 * Wallet-only idempotency-key lifecycle for utility checkout, extracted
 * from `useUtilityPurchase` to keep that hook under the 300-line
 * modularity budget. Keys live in the module registry (survives modal
 * remounts); this hook only scopes signatures to the authenticated
 * owner.
 *
 * Owner is the stable session user ID first (NOT customer-first like
 * the wallet reads): the customer record hydrates later, and flipping
 * scope mid-session would orphan the pending key and double-debit the
 * retry. Merchant is the immutable ID, never the slug: the route
 * resolves a renamed slug through aliases to the same merchant, so a
 * slug-scoped retry would miss the stored key and debit twice.
 */
export function useUtilityIdempotencyKey({
  customerId,
  merchantId,
  userId,
}: UseUtilityIdempotencyKeyInput): UseUtilityIdempotencyKeyResult {
  // Scoped key of the attempt on the success/processing screen: the
  // voucher backfill settles it when a 202 later reports terminal, so
  // buy-again mints fresh instead of replaying the old vend as new.
  const shownAttemptScopedRef = useRef<string | null>(null);
  // The owning modal unmounts on close: gate registry forgets on
  // this — an unmounted success must retain its key so reopening
  // replays instead of minting fresh and debiting twice (hyTj).
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const isResultViewActive = () => mountedRef.current;

  const captureAttemptKey = (payloadSignature: string) => {
    // merchantId is guaranteed defined here: the purchase readiness
    // gate blocks submit until the merchant hydrates, so no attempt
    // is ever scoped under '' (a post-hydration retry would miss it
    // and double-debit).
    const scoped = scopePendingVtuSignature(
      userId ?? customerId,
      merchantId,
      payloadSignature
    );
    const recalled = recallPendingVtuKey(scoped) !== undefined;
    return { key: getPendingVtuKey(scoped), scoped, recalled };
  };

  const forgetScopedKey = (scoped: string) => {
    forgetPendingVtuPurchase(scoped);
  };

  const noteScopedReference = (scoped: string, reference: string) => {
    notePendingVtuReference(scoped, reference);
  };

  const isScopedStale = (scoped: string, reference: string) => {
    return isStalePendingVtuSuccess(scoped, reference);
  };

  const isScopedReplay = (scoped: string, reference: string) => {
    return hasNotedPendingVtuReference(scoped, reference);
  };

  const markAttemptShown = (scoped: string | null) => {
    shownAttemptScopedRef.current = scoped;
  };

  const settleShownAttempt = () => {
    // The backfill proved the shown 202 terminal: forget its retained
    // key so buy-again mints fresh instead of replaying the old vend
    // as a new success. Idempotent (a second call is a no-op).
    if (shownAttemptScopedRef.current) {
      forgetPendingVtuPurchase(shownAttemptScopedRef.current);
      shownAttemptScopedRef.current = null;
    }
  };

  return {
    captureAttemptKey,
    forgetScopedKey,
    isResultViewActive,
    isScopedReplay,
    isScopedStale,
    markAttemptShown,
    noteScopedReference,
    settleShownAttempt,
  };
}
