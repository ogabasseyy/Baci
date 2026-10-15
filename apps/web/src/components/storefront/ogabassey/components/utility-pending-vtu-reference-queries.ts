/**
 * Pure reference queries over pending VTU entries (web).
 *
 * Extracted from `utility-pending-idempotency.ts` per the 300-line
 * modularity boundary (Codex R100 P1, mobile mirror): the registry's
 * noted-reference readers are pure over the live map, so they take it
 * as a parameter and the registry keeps thin wrappers (the list
 * wrapper still syncs cross-tab state first; call sites unchanged).
 */

export interface PendingVtuQueryEntry {
  reference: string | null;
  scopeTag?: string;
}

export interface PendingVtuCompletionQueryEntry {
  reference: string | null;
  completedAt: number | null;
}

/** True when this reference was noted for the signature. */
export function hasNotedPendingVtuReferenceIn(
  entries: Pick<ReadonlyMap<string, PendingVtuQueryEntry>, 'get'>,
  payloadSignature: string,
  reference: string
): boolean {
  return entries.get(payloadSignature)?.reference === reference;
}

/**
 * Noted references across live entries, deduped: several descriptors
 * can note the same reference — one history read per reference is
 * enough. With a scope tag, other owners' tagged entries are
 * excluded; untagged fail open.
 */
export function listNotedPendingVtuReferencesFrom(
  entries: Iterable<PendingVtuQueryEntry>,
  scopeTag?: string
): string[] {
  const references = new Set<string>();
  for (const entry of entries) {
    if (
      entry.reference !== null &&
      (scopeTag === undefined ||
        entry.scopeTag === undefined ||
        entry.scopeTag === scopeTag)
    ) {
      references.add(entry.reference);
    }
  }
  return [...references];
}

/**
 * True when a success response replays an already-completed purchase
 * instead of resolving the current submit: same NOTED reference AND
 * completion observed past the recall window. Staleness keys off the
 * COMPLETION time, never the submit/noted time — a slow first
 * completion (e.g. via reconciliation minutes after a 202) is
 * presented instead of misreported as "Already Completed" (which
 * would forget the key and double-debit the prompted retry).
 * Entries with no OBSERVED completion are NEVER stale; past the TTL
 * recall already dropped them, so this predicate never sees them.
 */
export function isStalePendingVtuSuccessIn(
  entries: Pick<ReadonlyMap<string, PendingVtuCompletionQueryEntry>, 'get'>,
  payloadSignature: string,
  reference: string,
  now: number,
  staleAfterMs: number
): boolean {
  const pending = entries.get(payloadSignature);
  if (
    !pending ||
    pending.reference === null ||
    pending.reference !== reference ||
    pending.completedAt === null
  ) {
    return false;
  }
  return now - pending.completedAt > staleAfterMs;
}

/** Records observed success on a RETAINED entry (first wins). */
export function markPendingVtuCompletedIn(
  entries: Pick<Map<string, PendingVtuCompletionQueryEntry>, 'get'>,
  persist: () => void,
  payloadSignature: string,
  now: number
): void {
  const pending = entries.get(payloadSignature);
  if (pending && pending.completedAt === null) {
    pending.completedAt = now;
    persist();
  }
}
