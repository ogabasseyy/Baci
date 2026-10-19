/**
 * Strict lookup policy for the wallet-only VTU route. A transient
 * Supabase error must 500 (clients keep the idempotency key) instead
 * of collapsing into a terminal 400/404 (key rotated — a retry after
 * the database recovers mints fresh and debits twice). Legacy callers
 * pass no flag and keep null/404 behavior.
 *
 * Lives here (not in vtu-pending-transaction.ts) per the Boy Scout
 * Rule: that module is already far beyond the 300-line budget, so new
 * policy must not extend it further.
 */
export type StrictVtuLookupContext =
  | 'resolve VTU merchant'
  | 'load VTU merchant settings'
  | 'look up VTU customer';

/**
 * Throws a generic 500-class error when strict lookups are on and the
 * PostgREST lookup errored. The message deliberately matches none of
 * the user-facing whitelist entries, so the route's catch-all returns
 * the generic 500 without leaking database text.
 */
export function throwIfStrictVtuLookupError({
  context,
  error,
  strictLookups = false,
}: {
  context: StrictVtuLookupContext;
  error: { message: string } | null;
  strictLookups?: boolean;
}): void {
  if (strictLookups && error) {
    throw new Error(`Failed to ${context}: ${error.message}`);
  }
}
