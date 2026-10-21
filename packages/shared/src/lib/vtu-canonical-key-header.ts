/**
 * Response header carrying the server's canonical (winner)
 * idempotency key after a wallet-only intent-claim join. The
 * loser's key has no mapping, so clients adopt this key for
 * subsequent retries instead of re-preparing + orphaning on
 * every attempt. Single source for the route (writer) and both
 * clients (readers).
 */
export const VTU_CANONICAL_IDEMPOTENCY_KEY_HEADER =
  'X-Vtu-Canonical-Idempotency-Key';
