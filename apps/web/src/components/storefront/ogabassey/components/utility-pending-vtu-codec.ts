/**
 * Snapshot codec for pending VTU idempotency keys (web).
 *
 * Extracted from `utility-pending-idempotency-store.ts` per the
 * 300-line Boy Scout Rule (Codex R56 6rrhXm): pure serialization,
 * TTL pruning, legacy-key migration, and tombstone round-tripping
 * live here — storage-free and safe to import anywhere. The
 * localStorage backend stays in the store.
 *
 * Privacy note: snapshot keys are SHA-256 digests of the purchase
 * scope (recipient phone / meter identifiers never rest here in
 * plaintext — unlike the sessionStorage utility draft, which still
 * does). Deterministic, so recall re-derives the same digest from the
 * payload; unsalted, because any on-disk salt is as readable as the
 * snapshot and would break cross-tab recall. Recall stays
 * owner+merchant scoped (a foreign account can never USE these keys)
 * and entries expire after 7 days, but the digest is verifiable by
 * anyone who can guess the payload (same-profile devtools), so
 * app-wide sign-out storage clearing remains the real fix for the
 * shared-device class (orders, drafts, and this snapshot alike);
 * tracked separately. Deliberately NOT cleared on sign-out/switch:
 * the signer's entries must survive their absence so a switch-back
 * retry replays instead of minting fresh and double-debiting. The
 * 7-day TTL is the clearing mechanism (bounded retention without
 * breaking recovery).
 *
 * Deploy-window residual: a tab still running pre-digest code cannot
 * read digest keys a post-deploy tab persisted (migrate-on-read only
 * bridges old snapshots to new code, not the reverse), so the same
 * purchase submitted in both tabs during the window mints twice.
 * Same class as the documented simultaneous-mint residual, strictly
 * rarer (needs cross-version tabs plus the same purchase in both),
 * and it heals on the old tab's next reload. Dual-writing both
 * formats would close it but keeps raw identifiers at rest
 * indefinitely, defeating the digest migration — deliberately not
 * done.
 */
import {
  isLegacyVtuScopeKey,
  normalizePersistedVtuScopeKey,
} from '@baci/shared';


/**
 * How long a persisted entry survives across reloads. Independent of
 * the 5-minute stale window (which governs already-completed
 * detection): a reloaded-then-retried purchase needs its ORIGINAL key
 * however old, and the stale check still correctly flags it as
 * already-completed when the remembered reference matches.
 */
export const PERSISTED_VTU_KEY_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * TTL expiry with referenced-processing retention (Codex R61 6rtSNk):
 * referenced-but-uncompleted entries outlive the TTL because the
 * server keeps provider-unknown rows processing indefinitely —
 * deleting the key mapping would mint fresh on retry and
 * double-debit. Retention ends on observed terminality.
 */
export function isExpiredPendingVtuEntry(
  entry: PersistedPendingVtuEntry,
  now: number = Date.now()
): boolean {
  if (now - entry.rememberedAt <= PERSISTED_VTU_KEY_TTL_MS) return false;
  return entry.reference === null || entry.completedAt != null;
}


export interface PersistedPendingVtuEntry {
  key: string;
  reference: string | null;
  rememberedAt: number;
  /** Null for entries snapshotted before completion tracking shipped. */
  completedAt?: number | null;
}

/**
 * Deletion tombstone: a scope another tab deliberately forgot. Without
 * these, tab B keeps a deleted entry in memory and writes it back on
 * its next persist, resurrecting a completed key (stale success replay
 * without a new debit). `forgottenAt` arbitrates against re-remember:
 * an entry remembered after the tombstone wins.
 * `key` (when present) binds the tombstone to the deleted key
 * generation: a newer in-flight key under the same scope must
 * survive a tombstone written for an older generation (Codex R55
 * 6rrMIj). Absent on tombstones written before the binding
 * shipped — those fall back to timestamp arbitration.
 */
export interface PersistedVtuTombstone {
  scoped: string;
  forgottenAt: number;
  key?: string;
}

export interface ParsedPendingVtuSnapshot {
  entries: [string, PersistedPendingVtuEntry][];
  forgotten: PersistedVtuTombstone[];
}

export type PendingVtuEntryInput = [
  string,
  {
    key: string;
    reference: string | null;
    rememberedAt: number;
    completedAt?: number | null;
  },
];

function isPersistedEntry(
  value: unknown
): value is [string, PersistedPendingVtuEntry] {
  if (!Array.isArray(value) || value.length !== 2) {
    return false;
  }
  const [scoped, entry] = value;
  return (
    typeof scoped === 'string' &&
    typeof entry === 'object' &&
    entry !== null &&
    typeof (entry as PersistedPendingVtuEntry).key === 'string' &&
    typeof (entry as PersistedPendingVtuEntry).rememberedAt === 'number'
  );
}

function isPersistedTombstone(
  value: unknown
): value is PersistedVtuTombstone {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const tombstone = value as PersistedVtuTombstone;
  return (
    typeof tombstone.scoped === 'string' &&
    typeof tombstone.forgottenAt === 'number'
  );
}

/**
 * Serializes live entries + deletion tombstones for storage (prunes
 * TTL-expired entries of any reference state — mirrors live recall,
 * so a single uniform 7-day horizon governs retention everywhere;
 * tombstones past the horizon are dropped too since the entries they
 * guard have expired regardless).
 */
export function serializePendingVtuEntries(
  entries: Iterable<PendingVtuEntryInput>,
  forgotten: Iterable<PersistedVtuTombstone>,
  now: number = Date.now()
): string {
  const live: [string, PersistedPendingVtuEntry][] = [];
  for (const [scoped, entry] of entries) {
    if (!isExpiredPendingVtuEntry(entry, now)) {
      live.push([
        scoped,
        {
          key: entry.key,
          reference: entry.reference,
          rememberedAt: entry.rememberedAt,
          completedAt: entry.completedAt ?? null,
        },
      ]);
    }
  }
  const liveForgotten: PersistedVtuTombstone[] = [];
  for (const tombstone of forgotten) {
    if (now - tombstone.forgottenAt <= PERSISTED_VTU_KEY_TTL_MS) {
      liveForgotten.push({
        scoped: tombstone.scoped,
        forgottenAt: tombstone.forgottenAt,
        ...(typeof tombstone.key === 'string' ? { key: tombstone.key } : {}),
      });
    }
  }
  return JSON.stringify({ entries: live, forgotten: liveForgotten });
}

/**
 * Parses a snapshot back into entries + tombstones. Corrupt snapshots
 * and TTL-expired items are dropped (mirrors live recall). Legacy
 * bare-array snapshots (entries only) still parse, with no tombstones.
 * Legacy raw scope keys migrate to digests on read (both entries and
 * tombstones, so suppression matching stays consistent).
 */
export function parsePendingVtuSnapshot(
  serialized: string | null,
  now: number = Date.now()
): ParsedPendingVtuSnapshot {
  const empty: ParsedPendingVtuSnapshot = { entries: [], forgotten: [] };
  if (!serialized) {
    return empty;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    return empty;
  }
  const rawEntries = Array.isArray(parsed)
    ? parsed
    : (parsed as { entries?: unknown })?.entries;
  const rawForgotten = Array.isArray(parsed)
    ? []
    : ((parsed as { forgotten?: unknown })?.forgotten ?? []);
  if (!Array.isArray(rawEntries) || !Array.isArray(rawForgotten)) {
    return empty;
  }
  const entries: [string, PersistedPendingVtuEntry][] = [];
  for (const item of rawEntries) {
    if (!isPersistedEntry(item)) {
      continue;
    }
    const [scoped, entry] = item;
    if (isExpiredPendingVtuEntry(entry, now)) {
      continue;
    }
    entries.push([
      normalizePersistedVtuScopeKey(scoped),
      {
        key: entry.key,
        reference: entry.reference ?? null,
        rememberedAt: entry.rememberedAt,
        // Pre-completion-tracking snapshots omit this: fail open (first
        // replay presents success, then forgets — never "Completed").
        completedAt:
          typeof entry.completedAt === 'number' ? entry.completedAt : null,
      },
    ]);
  }
  const forgotten: PersistedVtuTombstone[] = [];
  for (const item of rawForgotten) {
    if (!isPersistedTombstone(item)) {
      continue;
    }
    if (now - item.forgottenAt > PERSISTED_VTU_KEY_TTL_MS) {
      continue;
    }
    forgotten.push({
      scoped: normalizePersistedVtuScopeKey(item.scoped),
      forgottenAt: item.forgottenAt,
      // Non-string keys degrade to keyless (timestamp arbitration)
      // rather than dropping the deletion intent.
      ...(typeof item.key === 'string' ? { key: item.key } : {}),
    });
  }
  return { entries, forgotten };
}

/**
 * True when a snapshot still holds raw scope keys at rest. The sync
 * layer persists once after hydrating such a snapshot so the
 * migrate-on-read digests actually replace the plaintext (otherwise
 * an abandoned entry keeps its identifiers until an unrelated
 * mutation persists — Codex R54 6rrFRH). Shape-tolerant like the
 * parser (bare array or {entries, forgotten}); corrupt snapshots
 * report false — parse drops them, and clearing them is out of the
 * migration's scope.
 */
export function hasLegacyVtuScopeKeys(serialized: string | null): boolean {
  if (!serialized) {
    return false;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    return false;
  }
  const rawEntries = Array.isArray(parsed)
    ? parsed
    : (parsed as { entries?: unknown })?.entries;
  const rawForgotten = Array.isArray(parsed)
    ? []
    : ((parsed as { forgotten?: unknown })?.forgotten ?? []);
  if (Array.isArray(rawEntries)) {
    for (const item of rawEntries) {
      if (
        Array.isArray(item) &&
        typeof item[0] === 'string' &&
        isLegacyVtuScopeKey(item[0])
      ) {
        return true;
      }
    }
  }
  if (Array.isArray(rawForgotten)) {
    for (const item of rawForgotten) {
      if (
        typeof item === 'object' &&
        item !== null &&
        typeof (item as { scoped?: unknown }).scoped === 'string' &&
        isLegacyVtuScopeKey((item as { scoped: string }).scoped)
      ) {
        return true;
      }
    }
  }
  return false;
}
