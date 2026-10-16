/**
 * Snapshot codec for the pending-VTU registry.
 *
 * Extracted from `pending-vtu-idempotency-store.ts` per the 300-line
 * Boy Scout Rule (Codex R56 6rrhXi): pure serialization, TTL
 * pruning, legacy-key migration, and tombstone suppression live
 * here — MMKV-free and safe to import anywhere. MMKV access and
 * tombstone lifecycle stay in the store.
 */
import {
  isLegacyVtuScopeKey,
  normalizePersistedVtuScopeKey,
} from '@baci/shared';

export interface PersistedPendingVtuPurchase {
  key: string;
  reference: string | null;
  rememberedAt: number;
  /** Absent for entries snapshotted before completion tracking shipped. */
  completedAt?: number | null;
  /** Owner+merchant scope tag; absent on pre-tag snapshots. */
  scopeTag?: string;
}

/**
 * Deletion tombstone: a scope the registry deliberately forgot. Without
 * these, a failed MMKV write leaves the stale snapshot holding the
 * just-completed entry, and the next restart resurrects its old key —
 * an identical purchase then presents the previous vend as new
 * without charging. `forgottenAt` arbitrates against re-remember: an
 * entry remembered after the tombstone wins. Mirrors web's
 * `PersistedVtuTombstone`, including the key-bound R61 shape — the
 * codec suppresses snapshot entries directly, and
 * syncPendingVtuPurchasesFromSnapshot arbitrates runtime merges.
 */
export interface PersistedVtuTombstone {
  scoped: string;
  forgottenAt: number;
  /** Key of the deleted generation; absent on pre-binding snapshots. */
  key?: string;
}

export interface ParsedPendingVtuSnapshot {
  entries: [string, PersistedPendingVtuPurchase][];
  forgotten: PersistedVtuTombstone[];
}

/**
 * How long a persisted entry survives across restarts. Independent of
 * the 5-minute stale window: a restarted-then-retried purchase needs
 * its ORIGINAL key however old, and the stale check still correctly
 * flags it as already-completed when the remembered reference matches.
 */
export const PERSISTED_VTU_KEY_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * TTL expiry (R61/R63 uncompleted retention, R69 completion-based
 * horizon): uncompleted entries outlive the TTL; observed-completed
 * entries expire 7d after COMPLETION, not submit — a transaction
 * processing past the submit TTL then completing must still replay.
 */
export function isExpiredPendingVtuEntry(
  entry: PersistedPendingVtuPurchase,
  now: number = Date.now()
): boolean {
  const horizonBase = entry.completedAt ?? entry.rememberedAt;
  if (now - horizonBase <= PERSISTED_VTU_KEY_TTL_MS) return false;
  return entry.completedAt != null;
}

function isPersistedEntry(
  item: unknown
): item is [string, PersistedPendingVtuPurchase] {
  if (!Array.isArray(item) || item.length !== 2) {
    return false;
  }
  const [scoped, entry] = item as [unknown, unknown];
  if (typeof scoped !== 'string' || typeof entry !== 'object' || !entry) {
    return false;
  }
  return (
    typeof (entry as PersistedPendingVtuPurchase).key === 'string' &&
    typeof (entry as PersistedPendingVtuPurchase).rememberedAt === 'number'
  );
}

function isPersistedTombstone(item: unknown): item is PersistedVtuTombstone {
  if (typeof item !== 'object' || !item) {
    return false;
  }
  const candidate = item as PersistedVtuTombstone;
  return (
    typeof candidate.scoped === 'string' &&
    typeof candidate.forgottenAt === 'number' &&
    (candidate.key === undefined || typeof candidate.key === 'string')
  );
}

/**
 * Serializes live entries + tombstones, pruning TTL-expired ones of
 * any reference state — mirrors live recall, so a single uniform
 * 7-day horizon governs retention everywhere.
 */
export function serializePendingVtuEntries(
  entries: Iterable<[string, PersistedPendingVtuPurchase]>,
  forgotten: Iterable<PersistedVtuTombstone>,
  now: number = Date.now()
): string {
  const live: [string, PersistedPendingVtuPurchase][] = [];
  for (const [scoped, entry] of entries) {
    if (!isExpiredPendingVtuEntry(entry, now)) {
      live.push([
        scoped,
        {
          key: entry.key,
          reference: entry.reference ?? null,
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
        ...(tombstone.key !== undefined ? { key: tombstone.key } : {}),
      });
    }
  }
  return JSON.stringify({ entries: live, forgotten: liveForgotten });
}

/**
 * Parses a snapshot back into entries + tombstones. Corrupt snapshots
 * and TTL-expired items are dropped (fail-open: losing dedupe state
 * is recoverable via the server idempotency key check). Legacy
 * bare-array snapshots (entries only) still parse, with no
 * tombstones. Entries at or below their tombstone's generation are
 * suppressed HERE (key-bound: only the deleted generation's key —
 * keyless legacy tombstones fall back to timestamps), and the
 * runtime sync re-applies the same arbitration against live memory
 * for Expo web tabs sharing the bucket (Codex R143 P1). Legacy
 * raw scope keys migrate to digests on read, on both sides of the
 * suppression comparison, so old tombstones still suppress old entries.
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
  // Legacy bare-array snapshots (entries only) still parse.
  const rawEntries: unknown = Array.isArray(parsed)
    ? parsed
    : (parsed as { entries?: unknown } | null)?.entries;
  const rawForgotten: unknown = Array.isArray(parsed)
    ? []
    : (parsed as { forgotten?: unknown } | null)?.forgotten;
  const forgotten = (Array.isArray(rawForgotten) ? rawForgotten : [])
    .filter(isPersistedTombstone)
    .filter(
      (tombstone) => now - tombstone.forgottenAt <= PERSISTED_VTU_KEY_TTL_MS
    )
    .map((tombstone) => ({
      scoped: normalizePersistedVtuScopeKey(tombstone.scoped),
      forgottenAt: tombstone.forgottenAt,
      ...(tombstone.key !== undefined ? { key: tombstone.key } : {}),
    }));
  const tombstoned = new Map(
    forgotten.map((tombstone) => [tombstone.scoped, tombstone])
  );
  const entries = (Array.isArray(rawEntries) ? rawEntries : [])
    .filter(
      (item): item is [string, PersistedPendingVtuPurchase] =>
        isPersistedEntry(item) && !isExpiredPendingVtuEntry(item[1], now)
    )
    .filter(([scoped, entry]) => {
      // Key-bound like web R61 (Codex R143 P1): a newer generation
      // (different key) survives an older generation's tombstone even
      // when remembered earlier — timestamp-only suppression would
      // erase a sibling tab's active key and a retry would mint
      // fresh and debit again. Keyless tombstones (pre-binding)
      // keep timestamp arbitration.
      const tombstone = tombstoned.get(normalizePersistedVtuScopeKey(scoped));
      return (
        tombstone === undefined ||
        entry.rememberedAt > tombstone.forgottenAt ||
        (tombstone.key !== undefined && tombstone.key !== entry.key)
      );
    })
    .map(([scoped, entry]): [string, PersistedPendingVtuPurchase] => [
      normalizePersistedVtuScopeKey(scoped),
      {
        key: entry.key,
        reference: entry.reference ?? null,
        rememberedAt: entry.rememberedAt,
        // Pre-completion-tracking snapshots omit this: fail open
        // (first replay presents success, then resets).
        completedAt:
          typeof entry.completedAt === 'number' ? entry.completedAt : null,
        // Pre-tag snapshots omit this: untagged entries fail open in
        // owner-scoped settle filters (their owner is unknowable).
        ...(typeof entry.scopeTag === 'string'
          ? { scopeTag: entry.scopeTag }
          : {}),
      },
    ]);
  return { entries, forgotten };
}

/**
 * True when a snapshot still holds raw scope keys at rest. The
 * registry persists once after hydrating such a snapshot so the
 * migrate-on-read digests actually replace the plaintext (otherwise
 * an abandoned entry keeps its identifiers for the full TTL —
 * Codex R54 6rrFRH). Shape-tolerant like the parser; corrupt
 * snapshots report false.
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
  const rawEntries: unknown = Array.isArray(parsed)
    ? parsed
    : (parsed as { entries?: unknown } | null)?.entries;
  const rawForgotten: unknown = Array.isArray(parsed)
    ? []
    : (parsed as { forgotten?: unknown } | null)?.forgotten;
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
