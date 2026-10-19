import { hashVtuScopeDescriptor, isVtuScopeHash } from './vtu-scope-hash';

/**
 * True for a raw scope key the migration must hash: colon-bearing
 * (both scope separators and the descriptor JSON's own — even empty
 * merchant/owner still emit the separators) and not already a
 * digest. Bare colon-less keys are unproducible by either scope
 * choke point (only test fixtures) and pass through.
 *
 * Split from vtu-scope-hash.ts per the one-export rule (Codex R129
 * P1): hashing/detection stay there, migrate-on-read lives here.
 */
export function isLegacyVtuScopeKey(scoped: string): boolean {
  return !isVtuScopeHash(scoped) && scoped.includes(':');
}

/**
 * Migrates a persisted scope key to its digest form (migrate-on-read).
 *
 * Legacy snapshots hold raw `merchant:owner:<json>` keys, which always
 * contain colons (both scope separators and the descriptor JSON's own
 * — even empty merchant/owner still emit the separators); digests
 * never do. So: digests pass through, colon-bearing keys hash, and
 * bare colon-less keys (unproducible by either scope choke point —
 * only test fixtures) pass through untouched. Deterministic, so
 * re-parsing an already-migrated snapshot is a no-op and entries
 * still match their tombstones after both sides migrate.
 *
 * INVARIANT: if a scope format ever stops emitting colons, this
 * detector must change with it or raw keys will persist unhashed.
 */
export function normalizePersistedVtuScopeKey(scoped: string): string {
  if (!isLegacyVtuScopeKey(scoped)) {
    return scoped;
  }
  return hashVtuScopeDescriptor(scoped);
}
