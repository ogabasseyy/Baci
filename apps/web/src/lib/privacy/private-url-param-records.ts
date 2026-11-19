import type { PrivateEntry } from './sensitive-url-params';

const STASH_KEY_PREFIX = 'baci:private-url-params:';
const MAX_STASH_RECORDS = 30;

export interface StashRecord {
  pathname: string;
  publicSearch: string;
  entries: PrivateEntry[];
  savedAt: number;
}

// Fallback when sessionStorage is unavailable (blocked, full, strict privacy
// modes): the values then live in this page's memory, so they survive in-page
// navigation but NOT a reload. Scrubbing the address bar still happens: a
// token that is lost on reload is better than a token left in the address.
const memoryRecords = new Map<string, StashRecord>();

function stashKey(id: string): string {
  return `${STASH_KEY_PREFIX}${id}`;
}

function pruneOldRecords(storage: Storage): void {
  const records: { key: string; savedAt: number }[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key?.startsWith(STASH_KEY_PREFIX)) continue;
    let savedAt = 0;
    try {
      const parsed: unknown = JSON.parse(storage.getItem(key) ?? '');
      const value = (parsed as { savedAt?: unknown } | null)?.savedAt;
      if (typeof value === 'number') savedAt = value;
    } catch {
      // Unreadable records sort oldest and are removed first.
    }
    records.push({ key, savedAt });
  }
  if (records.length <= MAX_STASH_RECORDS) return;
  records.sort((a, b) => a.savedAt - b.savedAt);
  for (const { key } of records.slice(0, records.length - MAX_STASH_RECORDS)) {
    storage.removeItem(key);
  }
}

export function saveRecord(id: string, record: StashRecord): void {
  try {
    window.sessionStorage.setItem(stashKey(id), JSON.stringify(record));
  } catch {
    memoryRecords.set(id, record);
  }
}

/** Drops the oldest records beyond the cap, in storage and in the memory fallback. */
export function pruneRecords(): void {
  try {
    pruneOldRecords(window.sessionStorage);
  } catch {
    // Blocked storage: nothing persisted to prune.
  }
  for (const id of memoryRecords.keys()) {
    if (memoryRecords.size <= MAX_STASH_RECORDS) break;
    memoryRecords.delete(id); // Map keeps insertion order: oldest first
  }
}

export function removeRecord(id: string): void {
  memoryRecords.delete(id);
  try {
    window.sessionStorage.removeItem(stashKey(id));
  } catch {
    // Nothing more to clean up.
  }
}

export function loadRecord(id: string): unknown {
  try {
    const raw = window.sessionStorage.getItem(stashKey(id));
    if (raw) return JSON.parse(raw);
  } catch {
    // Unreadable or blocked storage: look in memory.
  }
  return memoryRecords.get(id);
}
