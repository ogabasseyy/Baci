'use client';

import { useRef } from 'react';
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

interface UseUtilityIdempotencyKeyResult {
  forgetAttemptKey: () => void;
  getWalletIdempotencyKey: (payloadSignature: string) => string;
  isAttemptReplay: (reference: string) => boolean;
  isAttemptStale: (reference: string) => boolean;
  noteAttemptReference: (reference: string) => void;
  wasAttemptKeyRecalled: () => boolean;
}

/**
 * Wallet-only idempotency-key lifecycle for utility checkout, extracted
 * from `useUtilityPurchase` to keep that hook under the 300-line
 * modularity budget. Keys live in the module registry (survives modal
 * remounts); this hook only tracks which signature the in-flight
 * attempt used and scopes recall to the authenticated owner.
 */
export function useUtilityIdempotencyKey({
  customerId,
  merchantId,
  userId,
}: UseUtilityIdempotencyKeyInput): UseUtilityIdempotencyKeyResult {
  // Owner is the stable session user ID first (NOT customer-first like
  // the wallet reads): the customer record hydrates later, and flipping
  // scope mid-session would orphan the pending key and double-debit the
  // retry. Merchant is the immutable ID, never the slug: the route
  // resolves a renamed slug through aliases to the same merchant, so a
  // slug-scoped retry would miss the stored key and debit twice. The
  // scope is captured ONCE per submission (not a module global), so an
  // account switch mid-flight cannot redirect this submission's
  // completion onto another customer's entry.
  const lastScopedSignatureRef = useRef<string | null>(null);
  // True when the in-flight attempt reused a previously-submitted key.
  // A recalled key's success is definitionally ambiguous (the debit may
  // already be reflected in the displayed balance), so callers refresh
  // for server truth instead of decrementing locally.
  const lastAttemptRecalledRef = useRef(false);

  const getWalletIdempotencyKey = (payloadSignature: string) => {
    const scoped = scopePendingVtuSignature(
      userId ?? customerId,
      merchantId,
      payloadSignature
    );
    lastScopedSignatureRef.current = scoped;
    lastAttemptRecalledRef.current =
      recallPendingVtuKey(scoped) !== undefined;
    return getPendingVtuKey(scoped);
  };

  const forgetAttemptKey = () => {
    if (lastScopedSignatureRef.current) {
      forgetPendingVtuPurchase(lastScopedSignatureRef.current);
      lastScopedSignatureRef.current = null;
    }
  };

  const noteAttemptReference = (reference: string) => {
    if (lastScopedSignatureRef.current) {
      notePendingVtuReference(lastScopedSignatureRef.current, reference);
    }
  };

  const isAttemptStale = (reference: string) => {
    if (!lastScopedSignatureRef.current) {
      return false;
    }
    return isStalePendingVtuSuccess(
      lastScopedSignatureRef.current,
      reference
    );
  };

  const isAttemptReplay = (reference: string) => {
    if (!lastScopedSignatureRef.current) {
      return false;
    }
    return hasNotedPendingVtuReference(
      lastScopedSignatureRef.current,
      reference
    );
  };

  const wasAttemptKeyRecalled = () => lastAttemptRecalledRef.current;

  return {
    forgetAttemptKey,
    getWalletIdempotencyKey,
    isAttemptReplay,
    isAttemptStale,
    noteAttemptReference,
    wasAttemptKeyRecalled,
  };
}
