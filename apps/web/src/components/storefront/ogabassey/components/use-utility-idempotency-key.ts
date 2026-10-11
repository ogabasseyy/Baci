'use client';

import { useRef } from 'react';
import {
  forgetPendingVtuPurchase,
  getPendingVtuKey,
  hasNotedPendingVtuReference,
  isStalePendingVtuSuccess,
  notePendingVtuReference,
  setPendingVtuOwnerScope,
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
  // Same owner fallback the wallet reads with: a key remembered for one
  // customer must never be recalled for another after sign-out / switch.
  // Merchant is the immutable ID, never the slug: the route resolves a
  // renamed slug through aliases to the same merchant, so a slug-scoped
  // retry would miss the stored key and debit twice.
  setPendingVtuOwnerScope(customerId ?? userId, merchantId);
  const lastPayloadSignatureRef = useRef<string | null>(null);

  const getWalletIdempotencyKey = (payloadSignature: string) => {
    lastPayloadSignatureRef.current = payloadSignature;
    return getPendingVtuKey(payloadSignature);
  };

  const forgetAttemptKey = () => {
    if (lastPayloadSignatureRef.current) {
      forgetPendingVtuPurchase(lastPayloadSignatureRef.current);
      lastPayloadSignatureRef.current = null;
    }
  };

  const noteAttemptReference = (reference: string) => {
    if (lastPayloadSignatureRef.current) {
      notePendingVtuReference(lastPayloadSignatureRef.current, reference);
    }
  };

  const isAttemptStale = (reference: string) => {
    if (!lastPayloadSignatureRef.current) {
      return false;
    }
    return isStalePendingVtuSuccess(
      lastPayloadSignatureRef.current,
      reference
    );
  };

  const isAttemptReplay = (reference: string) => {
    if (!lastPayloadSignatureRef.current) {
      return false;
    }
    return hasNotedPendingVtuReference(
      lastPayloadSignatureRef.current,
      reference
    );
  };

  return {
    forgetAttemptKey,
    getWalletIdempotencyKey,
    isAttemptReplay,
    isAttemptStale,
    noteAttemptReference,
  };
}
