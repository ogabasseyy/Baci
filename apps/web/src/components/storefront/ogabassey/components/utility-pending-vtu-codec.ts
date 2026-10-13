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
 * does). Deterministic and unsalted, so recall re-derives the same
 * digest from the payload. Recall stays owner+merchant scoped (a
 * foreign account can never USE these keys); the digest is
 * verifiable by anyone who can guess the payload (same-profile
 * devtools), so app-wide sign-out clearing remains the real fix
 * for the shared-device class (tracked separately). Deliberately
 * NOT cleared on sign-out/switch: the signer's entries must
 * survive their absence so a switch-back retry replays instead
 * of minting fresh and double-debiting (the TTL bounds retention).
 *
 * Deploy-window residual: a tab still running pre-digest code cannot
 * read digest keys a post-deploy tab persisted (migrate-on-read only
 * bridges old snapshots to new code), so the same purchase in both
 * tabs during the window mints twice. Rarer than the documented
 * simultaneous-mint residual and heals on reload; dual-writing both
 * formats would keep raw identifiers at rest — deliberately not done.
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
 * TTL expiry (R61/R63 uncompleted retention, R69 completion-based
 * horizon): uncompleted entries outlive the TTL; observed-completed
 * entries expire 7d after COMPLETION, not submit — a transaction
 * processing past the submit TTL then completing must still replay.
 */
export function isExpiredPendingVtuEntry(
  entry: PersistedPendingVtuEntry,
  now: number = Date.now()
): boolean {
  const horizonBase = entry.completedAt ?? entry.rememberedAt;
  if (now - horizonBase <= PERSISTED_VTU_KEY_TTL_MS) return false;
  return entry.completedAt != null;
}


export interface PersistedPendingVtuEntry {
  key: string;
  reference: string | null;
  rememberedAt: number;
  /** Null for entries snapshotted before completion tracking shipped. */
  completedAt?: number | null;
  /** Owner+merchant scope tag; absent on pre-tag snapshots. */
  scopeTag?: string;
}

/**
 * Deletion tombstone: a scope another tab deliberately forgot. Without
 * these, tab B keeps a deleted entry in memory and writes it back on
 * its next persist, resurrecting a completed key (stale success replay
 * without a new debit). `forgottenAt` arbitrates against re-remember;
 * `key` (when present) binds the deleted key generation so a newer
 * in-flight key survives an older generation's tombstone (R55 6rrMIj).
 * Keyless tombstones (pre-binding) keep timestamp arbitration.
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
    scopeTag?: string;
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
 * Serializes live entries + deletion tombstones for storage (drops
 * expired entries — referenced-processing outlive the TTL — and
 * horizon-aged tombstones guarding long-gone entries).
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
          ...(typeof entry.scopeTag === 'string'
            ? { scopeTag: entry.scopeTag }
            : {}),
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
        // Pre-tag snapshots omit this: untagged entries fail open in
        // owner-scoped settle filters (their owner is unknowable).
        ...(typeof entry.scopeTag === 'string'
          ? { scopeTag: entry.scopeTag }
          : {}),
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
