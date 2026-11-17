import {
  canonicalSearch,
  type PrivateEntry,
  partitionSensitiveSearch,
} from './sensitive-url-params';

const STASH_KEY_PREFIX = 'baci:private-url-params:';
const MAX_STASH_RECORDS = 30;

/**
 * Key of the custom `history.state` property that links one history entry to
 * its stash record. Next.js keeps custom keys passed to `replaceState`, and
 * preserves them on reload and back/forward (see use-private-search-params).
 */
export const PRIVATE_PARAMS_STATE_KEY = '__baciPrivateParams';

interface StashRecord {
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

let lastSavedAt = 0;

/** Strictly increasing, so records saved in the same millisecond keep their order. */
function nextSavedAt(): number {
  lastSavedAt = Math.max(Date.now(), lastSavedAt + 1);
  return lastSavedAt;
}

function stashKey(id: string): string {
  return `${STASH_KEY_PREFIX}${id}`;
}

function isEntryList(value: unknown): value is PrivateEntry[] {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        Array.isArray(entry) &&
        entry.length === 2 &&
        typeof entry[0] === 'string' &&
        typeof entry[1] === 'string'
    )
  );
}

/** Not a secret: it only links a history entry to its record. */
function newStashId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    // Insecure context or missing API: try the next source.
  }
  try {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    // Fall through to the last resort.
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}

function currentHistoryState(): Record<string, unknown> {
  const state: unknown = window.history.state;
  return typeof state === 'object' && state !== null
    ? { ...(state as Record<string, unknown>) }
    : {};
}

/** The stash id carried by the current history entry, if any. */
export function currentPrivateParamsId(): string | null {
  if (typeof window === 'undefined') return null;
  const id = currentHistoryState()[PRIVATE_PARAMS_STATE_KEY];
  return typeof id === 'string' && id !== '' ? id : null;
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

function saveRecord(id: string, record: StashRecord): void {
  try {
    window.sessionStorage.setItem(stashKey(id), JSON.stringify(record));
    pruneOldRecords(window.sessionStorage);
  } catch {
    memoryRecords.set(id, record);
  }
}

function removeRecord(id: string): void {
  memoryRecords.delete(id);
  try {
    window.sessionStorage.removeItem(stashKey(id));
  } catch {
    // Nothing more to clean up.
  }
}

function loadRecord(id: string): unknown {
  try {
    const raw = window.sessionStorage.getItem(stashKey(id));
    if (raw) return JSON.parse(raw);
  } catch {
    // Unreadable or blocked storage: look in memory.
  }
  return memoryRecords.get(id);
}

/**
 * Saves `entries` for the CURRENT history entry (fresh id on `history.state`)
 * and rewrites the address to `pathname` + `publicSearch`. Returns false, with
 * the address untouched, only if the address itself cannot be rewritten.
 */
export function stashEntriesOnCurrentEntry(
  entries: PrivateEntry[],
  pathname: string,
  publicSearch: string
): boolean {
  const id = newStashId();
  saveRecord(id, {
    pathname,
    publicSearch: canonicalSearch(publicSearch),
    entries,
    savedAt: nextSavedAt(),
  });
  try {
    window.history.replaceState(
      { ...currentHistoryState(), [PRIVATE_PARAMS_STATE_KEY]: id },
      '',
      // Fragments are deliberately left in place: the pages using this hook do
      // not receive tokens in fragments, and auth libraries may need them
      // (e.g. `#access_token=...`). `sanitizeTrackingUrl` drops fragments from
      // anything sent to analytics.
      `${pathname}${publicSearch ? `?${publicSearch}` : ''}${window.location.hash}`
    );
  } catch {
    removeRecord(id);
    return false;
  }
  return true;
}

/**
 * Moves sensitive query params (order tokens, shopper details) out of the
 * address bar so ad scripts reading `window.location.href` never see them.
 *
 * The values are kept in sessionStorage (or page memory when storage is not
 * available) under a fresh id, and that id is put on the current history entry
 * (`history.state`), so every entry gets its own stash: opening order A then
 * order B in one tab, then going Back, still shows A.
 */
export function scrubPrivateParamsFromAddressBar(): boolean {
  if (typeof window === 'undefined') return false;
  const { pathname, search } = window.location;
  const { privateEntries, publicSearch } = partitionSensitiveSearch(search);
  if (privateEntries.length === 0) return false;
  return stashEntriesOnCurrentEntry(privateEntries, pathname, publicSearch);
}

/**
 * Returns the entries stashed for the CURRENT history entry, but only when
 * they were saved for the same path and the same remaining query. It never
 * falls back to another entry's stash, so a fresh visit to the same path, or
 * a different order, never inherits an old token.
 */
export function readStashedPrivateParams(
  pathname: string,
  publicSearch: string
): PrivateEntry[] {
  const id = currentPrivateParamsId();
  if (id === null) return [];
  const parsed = loadRecord(id);
  if (typeof parsed !== 'object' || parsed === null) return [];
  const {
    pathname: storedPath,
    publicSearch: storedSearch,
    entries,
  } = parsed as Record<string, unknown>;
  if (
    storedPath !== pathname ||
    typeof storedSearch !== 'string' ||
    !isEntryList(entries)
  ) {
    return [];
  }
  return storedSearch === canonicalSearch(publicSearch) ? entries : [];
}
