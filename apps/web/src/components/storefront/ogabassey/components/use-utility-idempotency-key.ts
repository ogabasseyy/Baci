'use client';

import { useRef } from 'react';
import {
  forgetPendingVtuPurchase,
  getPendingVtuKey,
  isStalePendingVtuSuccess,
  notePendingVtuReference,
  setPendingVtuOwnerScope,
} from './utility-pending-idempotency';

interface UseUtilityIdempotencyKeyInput {
  customerId?: string;
  merchantSlug?: string;
  userId?: string;
}

interface UseUtilityIdempotencyKeyResult {
  forgetAttemptKey: () => void;
  getWalletIdempotencyKey: (payloadSignature: string) => string;
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
  merchantSlug,
  userId,
}: UseUtilityIdempotencyKeyInput): UseUtilityIdempotencyKeyResult {
  // Same owner fallback the wallet reads with: a key remembered for one
  // customer must never be recalled for another after sign-out / switch.
  setPendingVtuOwnerScope(customerId ?? userId, merchantSlug);
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

  return {
    forgetAttemptKey,
    getWalletIdempotencyKey,
    isAttemptStale,
    noteAttemptReference,
  };
}
