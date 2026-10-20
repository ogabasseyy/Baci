/**
 * Deletion tombstones for wallet-only VTU pending keys (mobile).
 *
 * Scopes deliberately deleted since the last persist. Sync imports
 * snapshot tombstones here too, so a completed key deleted in
 * another tab is dropped locally instead of written back on the
 * next persist. Cleared on every durable persist (the snapshot
 * then carries the tombstones).
 *
 * Records bind the deleted KEY generation, not just the scope: a
 * newer in-flight key under the same scope must survive a
 * tombstone written for an older generation (Codex R55) —
 * timestamp-only arbitration would erase it and its retry would
 * mint fresh and double-debit. Keyless records (pre-binding
 * snapshots) fall back to timestamp arbitration.
 *
 * Multi-key per scope (CodeRabbit Major): a non-durable canonical
 * adoption tombstones the persisted loser, then terminal settlement
 * tombstones the winner — single-slot replacement would drop the
 * loser record and resurrect the persisted loser on merge.
 * Same-key records refresh (newest wins); different generations
 * accumulate until the next durable persist carries them all.
 *
 * Split from pending-vtu-idempotency-store.ts per the 300-line
 * module-size gate (web mirror: forgottenScopedKeys in
 * utility-pending-vtu-sync.ts).
 */
import type { PersistedVtuTombstone } from './pending-vtu-idempotency-codec';

export interface ForgottenVtuTombstone {
  forgottenAt: number;
  key?: string;
}

export const forgottenVtuScopes = new Map<string, ForgottenVtuTombstone[]>();

/** Records deletion tombstones for scopes the registry just forgot. */
export function noteForgottenVtuScopes(
  scopes: string[],
  forgottenAt: number,
  key?: string
): void {
  for (const scoped of scopes) {
    const known = forgottenVtuScopes.get(scoped) ?? [];
    const same = known.find((record) => record.key === key);
    if (same !== undefined) {
      if (forgottenAt > same.forgottenAt) {
        same.forgottenAt = forgottenAt;
      }
    } else {
      known.push({ forgottenAt, key });
    }
    forgottenVtuScopes.set(scoped, known);
  }
}

/** Flattens every scope's records for snapshot serialization. */
export function listForgottenVtuTombstones(): PersistedVtuTombstone[] {
  return [...forgottenVtuScopes].flatMap(([scoped, records]) =>
    records.map((record) => ({
      scoped,
      forgottenAt: record.forgottenAt,
      ...(record.key !== undefined ? { key: record.key } : {}),
    }))
  );
}

/** Test-only escape hatch: module state survives across test cases. */
export function clearForgottenVtuScopes(): void {
  forgottenVtuScopes.clear();
}
