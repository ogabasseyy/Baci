import { NextResponse } from 'next/server';

/**
 * Maps a claim_vtu_intent failure to its route response (split from
 * the wallet-only checkout route per the one-primary-export rule):
 * same-key changed-payload races → 409 (same contract as the
 * replay path), scope mismatches → 400, everything else → 500
 * without leaking the raw DB error. The key itself is the
 * unguessable replay credential — logs carry the prepared
 * transaction id instead (Muse R108 MEDIUM).
 */
export function respondToClaimError(
  claimError: { message: string },
  transactionId: string
): NextResponse {
  // Same-key race lost on a changed payload: the key is mapped
  // with another fingerprint — same 409 contract as the replay
  // path. Scope mismatch (key-UUID collision; the route's
  // ownership checks already reject cross-tenant keys) → 400.
  if (claimError.message.startsWith('claim_fingerprint_mismatch')) {
    return NextResponse.json(
      {
        error:
          'Idempotency-Key already used with a different request payload. Generate a fresh key for the new purchase.',
      },
      { status: 409 }
    );
  }
  if (claimError.message.startsWith('claim_scope_mismatch')) {
    return NextResponse.json(
      { error: 'Idempotency-Key does not belong to this customer.' },
      { status: 400 }
    );
  }
  // Log internally; don't leak the raw DB error to the client.
  console.error('Failed to claim VTU purchase intent:', {
    error: claimError.message,
    transactionId,
  });
  return NextResponse.json(
    { error: 'Failed to claim VTU purchase intent.' },
    { status: 500 }
  );
}
