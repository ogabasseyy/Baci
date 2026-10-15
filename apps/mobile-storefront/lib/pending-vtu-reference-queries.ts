/**
 * Pure reference queries over pending VTU entries (mobile).
 *
 * Extracted from `pending-vtu-idempotency.ts` per the 300-line
 * modularity boundary (Codex R100 P1): the registry's noted-reference
 * readers are pure over the live map, so they take it as a parameter
 * and the registry keeps thin wrappers (call sites unchanged).
 */

export interface PendingVtuQueryEntry {
  reference: string | null;
  scopeTag?: string;
}

export interface PendingVtuCompletionQueryEntry {
  reference: string | null;
  completedAt: number | null;
}

/** True when this reference was noted for the descriptor. */
export function hasNotedPendingVtuReferenceIn(
  entries: Pick<ReadonlyMap<string, PendingVtuQueryEntry>, 'get'>,
  descriptor: string,
  reference: string
): boolean {
  return entries.get(descriptor)?.reference === reference;
}

/**
 * Noted references across live entries, deduped. With a scope tag,
 * other owners' tagged entries are excluded; untagged fail open.
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
 * True when a success replays an already-completed purchase: same
 * NOTED reference AND completion observed past the recall window, so
 * this submit is a NEW intent. Staleness keys off COMPLETION time
 * (slow first completions still present); unobserved completions
 * are NEVER stale.
 */
export function isStalePendingVtuSuccessIn(
  entries: Pick<ReadonlyMap<string, PendingVtuCompletionQueryEntry>, 'get'>,
  descriptor: string,
  reference: string,
  now: number,
  staleAfterMs: number
): boolean {
  const pending = entries.get(descriptor);
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
  descriptor: string,
  now: number
): void {
  const pending = entries.get(descriptor);
  if (pending && pending.completedAt === null) {
    pending.completedAt = now;
    persist();
  }
}
