/**
 * Session persistence for pending VTU idempotency keys (web).
 *
 * Pure snapshot helpers plus the sessionStorage backend. The registry
 * keeps the live map and binds these to it; splitting them out keeps
 * both files under the 300-line modularity budget.
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

/** Serializes live entries for storage (prunes TTL-expired). */
export function serializePendingVtuEntries(
  entries: Iterable<PendingVtuEntryInput>,
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
  return JSON.stringify(live);
}

/**
 * Parses a snapshot back into entries. Corrupt snapshots and
 * TTL-expired entries are dropped.
 */
export function parsePendingVtuSnapshot(
  serialized: string | null,
  now: number = Date.now()
): [string, PersistedPendingVtuEntry][] {
  if (!serialized) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  const entries: [string, PersistedPendingVtuEntry][] = [];
  for (const item of parsed) {
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
  return entries;
}

export function loadPendingVtuSnapshot(): string | null {
  try {
    if (typeof sessionStorage === 'undefined') {
      return null;
    }
    return sessionStorage.getItem(VTU_PENDING_KEYS_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function savePendingVtuSnapshot(serialized: string): void {
  try {
    if (typeof sessionStorage === 'undefined') {
      return;
    }
    sessionStorage.setItem(VTU_PENDING_KEYS_STORAGE_KEY, serialized);
  } catch {
    // Private-mode quota errors and friends: persistence is best
    // effort; the in-memory registry still dedupes this session.
  }
}

export function clearPendingVtuSnapshot(): void {
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem(VTU_PENDING_KEYS_STORAGE_KEY);
    }
  } catch {
    // Best effort (see savePendingVtuSnapshot).
  }
}
