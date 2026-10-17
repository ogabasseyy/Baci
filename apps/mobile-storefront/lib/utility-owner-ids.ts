/**
 * Wallet owner resolution for VTU purchases.
 *
 * Two policies, deliberately different — do not merge them into one
 * fallback order:
 *
 * - Reads and invalidations use the CUSTOMER row first. The wallet balance
 *   row is keyed by customer id (`fetchWalletData` takes the customer id as
 *   its first argument), so the query-key owner must stay customer-first to
 *   hit the row the server actually debited.
 * - Idempotency scope uses the AUTH USER first. It must stay referentially
 *   stable across customer-row hydration (user.id exists from session start;
 *   customer.id arrives later), otherwise one attempt lands in two scopes.
 *
 * Each call site names its policy via the helper it imports.
 */

/**
 * Owner for wallet reads and post-purchase invalidations
 * (customer-first). Null — never '' — when both identities are
 * absent: `walletKeys.data` throws on an empty owner, so the no-owner
 * state must be unrepresentable as an owner, not a falsy string a
 * future caller could forward. All callers falsy-guard.
 */
export function resolveWalletReadOwnerId(
  customerId: string | null | undefined,
  userId: string | null | undefined
): string | null {
  return customerId ?? userId ?? null;
}

/** Owner for VTU idempotency scope (user-first: stable across hydration). */
export function resolveIdempotencyScopeOwnerId(
  userId: string | null | undefined,
  customerId: string | null | undefined
): string | undefined {
  return userId ?? customerId ?? undefined;
}
