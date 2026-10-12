/**
 * Cross-tab persistence for pending VTU idempotency keys (web).
 *
 * Pure snapshot helpers plus the localStorage backend. The registry
 * keeps the live map and binds these to it; splitting them out keeps
 * both files under the 300-line modularity budget. localStorage (not
 * sessionStorage): a timeout followed by a retry in a new tab must
 * recall the same key — tab-scoped storage would mint fresh and the
 * route would debit a second transaction. Entries stay owner+merchant
 * scoped with the same 24h TTL, so another account still cannot recall
 * them. The registry merges the snapshot on recall/persist, so only
 * simultaneous cross-tab mints can still diverge (documented residual
 * — sync recall cannot take an async lock).
 *
 * Privacy note: snapshot keys embed the purchase signature (recipient
 * phone / meter identifiers) in plaintext, like the existing
 * sessionStorage utility draft. Recall is owner+merchant scoped (a
 * foreign account can never USE these keys) and entries expire after
 * 24h, but anyone with same-profile devtools access can read the
 * identifiers until then. True confidentiality is impossible here —
 * reload recovery requires the mapping to be readable after restart,
 * and any on-disk salt/key is equally readable — so hashing would
 * only deter casual glances while risking the recall path. App-wide
 * sign-out storage clearing is the real fix for the shared-device
 * class (orders, drafts, and this snapshot alike); tracked separately.
 */

/**
 * How long a persisted entry survives across reloads. Independent of
 * the 5-minute stale window (which governs already-completed
 * detection): a reloaded-then-retried purchase needs its ORIGINAL key
 * however old, and the stale check still correctly flags it as
 * already-completed when the remembered reference matches.
 */
export const PERSISTED_VTU_KEY_TTL_MS = 24 * 60 * 60 * 1000;

const VTU_PENDING_KEYS_STORAGE_KEY = 'baci:vtu-pending-keys/v1';

export interface PersistedPendingVtuEntry {
  key: string;
  reference: string | null;
  rememberedAt: number;
}

/**
 * Deletion tombstone: a scope another tab deliberately forgot. Without
 * these, tab B keeps a deleted entry in memory and writes it back on
 * its next persist, resurrecting a completed key (stale success replay
 * without a new debit). `forgottenAt` arbitrates against re-remember:
 * an entry remembered after the tombstone wins.
 */
export interface PersistedVtuTombstone {
  scoped: string;
  forgottenAt: number;
}

export interface ParsedPendingVtuSnapshot {
  entries: [string, PersistedPendingVtuEntry][];
  forgotten: PersistedVtuTombstone[];
}

export type PendingVtuEntryInput = [
  string,
  { key: string; reference: string | null; rememberedAt: number },
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
 * so a single uniform 24h horizon governs retention everywhere;
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
    if (now - entry.rememberedAt <= PERSISTED_VTU_KEY_TTL_MS) {
      live.push([
        scoped,
        {
          key: entry.key,
          reference: entry.reference,
          rememberedAt: entry.rememberedAt,
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
      });
    }
  }
  return JSON.stringify({ entries: live, forgotten: liveForgotten });
}

/**
 * Parses a snapshot back into entries + tombstones. Corrupt snapshots
 * and TTL-expired items are dropped (mirrors live recall). Legacy
 * bare-array snapshots (entries only) still parse, with no tombstones.
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
    if (now - entry.rememberedAt > PERSISTED_VTU_KEY_TTL_MS) {
      continue;
    }
    entries.push([
      scoped,
      {
        key: entry.key,
        reference: entry.reference ?? null,
        rememberedAt: entry.rememberedAt,
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
    forgotten.push({ scoped: item.scoped, forgottenAt: item.forgottenAt });
  }
  return { entries, forgotten };
}

export function loadPendingVtuSnapshot(): string | null {
  try {
    if (typeof localStorage === 'undefined') {
      return null;
    }
    return localStorage.getItem(VTU_PENDING_KEYS_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function savePendingVtuSnapshot(serialized: string): void {
  try {
    if (typeof localStorage === 'undefined') {
      return;
    }
    localStorage.setItem(VTU_PENDING_KEYS_STORAGE_KEY, serialized);
  } catch {
    // Private-mode quota errors and friends: persistence is best
    // effort; the in-memory registry still dedupes this session.
  }
}

export function clearPendingVtuSnapshot(): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(VTU_PENDING_KEYS_STORAGE_KEY);
    }
  } catch {
    // Best effort (see savePendingVtuSnapshot).
  }
}
