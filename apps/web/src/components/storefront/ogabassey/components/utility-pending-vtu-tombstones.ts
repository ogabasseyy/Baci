/**
 * Deletion tombstones for wallet-only VTU pending keys (web).
 *
 * Scopes deliberately deleted since the last persist (scope ->
 * deletion records). Sync imports snapshot tombstones here too, so
 * a completed key deleted in another tab is dropped locally
 * instead of written back on the next persist. Cleared on every
 * durable persist (the snapshot then carries the tombstones).
 *
 * Records bind the deleted KEY generation, not just the scope: a
 * newer in-flight key under the same scope must survive a
 * tombstone written for an older generation (Codex R55 6rrMIj) —
 * timestamp-only arbitration would erase it and its retry would
 * mint fresh and double-debit. Keyless records (pre-binding
 * snapshots) fall back to timestamp arbitration.
 *
 * Multi-key per scope (CodeRabbit Major, mobile mirror): a
 * non-durable canonical adoption tombstones the persisted loser,
 * then terminal settlement tombstones the winner — single-slot
 * replacement would drop the loser record and resurrect the
 * persisted loser on merge. Same-key records refresh (newest
 * wins); different generations accumulate until the next durable
 * persist carries them all.
 *
 * Split from utility-pending-vtu-sync.ts per the 300-line
 * module-size gate (mobile mirror:
 * pending-vtu-tombstones.ts).
 */
import type { PersistedVtuTombstone } from './utility-pending-vtu-codec';

export interface ForgottenVtuScope {
  forgottenAt: number;
  key?: string;
}

export const forgottenScopedKeys = new Map<string, ForgottenVtuScope[]>();

/**
 * Records a deliberate deletion (single choke point so the key
 * binding cannot be forgotten at one of the forget sites).
 * remember() deletes the records, so a record always postdates
 * the entry it names.
 */
export function noteForgottenVtuScope(
  scoped: string,
  forgottenAt: number,
  key?: string
): void {
  const known = forgottenScopedKeys.get(scoped) ?? [];
  const same = known.find((record) => record.key === key);
  if (same !== undefined) {
    if (forgottenAt > same.forgottenAt) {
      same.forgottenAt = forgottenAt;
    }
  } else {
    known.push({ forgottenAt, key });
  }
  forgottenScopedKeys.set(scoped, known);
}

/**
 * Suppression predicate shared by merge and the settlement
 * generation veto (CodeRabbit Minor): a tombstoned persisted
 * entry must neither merge nor converge back into memory.
 */
export function isVtuEntryTombstoned(
  scoped: string,
  entry: { rememberedAt: number; key: string }
): boolean {
  return (forgottenScopedKeys.get(scoped) ?? []).some(
    (tombstone) =>
      entry.rememberedAt <= tombstone.forgottenAt &&
      (tombstone.key === undefined || tombstone.key === entry.key)
  );
}

/** Flattens every scope's records for snapshot serialization. */
export function listForgottenVtuScopes(): PersistedVtuTombstone[] {
  return [...forgottenScopedKeys].flatMap(([scoped, records]) =>
    records.map((record) => ({
      scoped,
      forgottenAt: record.forgottenAt,
      ...(typeof record.key === 'string' ? { key: record.key } : {}),
    }))
  );
}

/** Test-only escape hatch: module state survives across renderHook mounts. */
export function clearForgottenVtuScopes(): void {
  forgottenScopedKeys.clear();
}
