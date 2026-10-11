'use client';

import type { UtilityCheckoutResult } from './utility-checkout-submit';
import {
  forgetPendingVtuPurchase,
  getPendingVtuKey,
  hasNotedPendingVtuReference,
  isStalePendingVtuSuccess,
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
  isScopedReplay: (scoped: string, reference: string) => boolean;
  isScopedStale: (scoped: string, reference: string) => boolean;
  noteScopedReference: (scoped: string, reference: string) => void;
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
 * Finalizes a settled attempt whose owner switched mid-flight, before
 * the caller suppresses the result UI. Terminal success forgets the
 * submitter's key (their repeat mints fresh instead of replaying the
 * old vend as a new success); processing notes the reference (replays
 * recognized). Status-bearing terminal errors forget the key too —
 * otherwise the retained key replays the dead transaction when the
 * submitter retries. Ambiguous errors keep the key so the retry
 * dedupes.
 */
export function finalizeSwitchedAttempt(
  attempt: UtilityIdempotencyAttempt | null,
  result: UtilityCheckoutResult
): void {
  if (!attempt) {
    return;
  }
  if (result.kind === 'wallet-success') {
    if (result.processing) {
      notePendingVtuReference(attempt.scoped, result.reference);
    } else {
      forgetPendingVtuPurchase(attempt.scoped);
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
  const captureAttemptKey = (payloadSignature: string) => {
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

  return {
    captureAttemptKey,
    forgetScopedKey,
    isScopedReplay,
    isScopedStale,
    noteScopedReference,
  };
}
