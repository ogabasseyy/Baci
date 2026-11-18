import { isEntryList } from './is-entry-list';
import {
  loadRecord,
  pruneRecords,
  removeRecord,
  saveRecord,
} from './private-url-param-records';
import {
  canonicalSearch,
  type PrivateEntry,
  partitionSensitiveSearch,
} from './sensitive-url-params';

/**
 * Key of the custom `history.state` property that links one history entry to
 * its stash record. Next.js keeps custom keys passed to `replaceState`, and
 * preserves them on reload and back/forward (see use-private-search-params).
 */
export const PRIVATE_PARAMS_STATE_KEY = '__baciPrivateParams';

/**
 * Marks a history entry the hook has seen WITHOUT a stash, so it can never
 * inherit one later (e.g. Back to an earlier tokenless entry that differs from
 * an order entry only by its fragment). A browser-created fragment entry starts
 * unmarked, which is what lets it inherit from the entry it was created on.
 */
const NO_STASH_STATE_KEY = '__baciNoPrivateParams';

let lastSavedAt = 0;

/** Strictly increasing, so records saved in the same millisecond keep their order. */
function nextSavedAt(): number {
  lastSavedAt = Math.max(Date.now(), lastSavedAt + 1);
  return lastSavedAt;
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

/**
 * Next.js's own history keys. Its patched `replaceState` skips the router
 * update (so `useSearchParams` keeps the old address) for any state carrying
 * `__NA`/`_N`, and re-adds `__NA` and the tree from the current entry itself.
 */
const NEXT_INTERNAL_STATE_KEYS = [
  '__NA',
  '_N',
  '__PRIVATE_NEXTJS_INTERNALS_TREE',
];

/**
 * The current history state with the stash id set, the no-stash marker removed
 * and Next.js's internal keys left out, so Next.js syncs its router state with
 * the rewritten address.
 */
function stateWithId(id: string): Record<string, unknown> {
  const state = currentHistoryState();
  delete state[NO_STASH_STATE_KEY];
  for (const key of NEXT_INTERNAL_STATE_KEYS) delete state[key];
  return { ...state, [PRIVATE_PARAMS_STATE_KEY]: id };
}

/** The stash id carried by the current history entry, if any. */
export function currentPrivateParamsId(): string | null {
  if (typeof window === 'undefined') return null;
  const id = currentHistoryState()[PRIVATE_PARAMS_STATE_KEY];
  return typeof id === 'string' && id !== '' ? id : null;
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
      stateWithId(id),
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
  // Only now: pruning before the rewrite could delete an older entry's record
  // that a failed rewrite then cannot restore.
  pruneRecords();
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

// The entry that owned a stash when the document last looked, so a fragment-only
// navigation (a new entry that browsers create without our history.state key)
// can keep it. Page memory only: a new document never inherits anything.
let lastOwner: { id: string; href: string } | null = null;

/**
 * Records the current entry as the stash owner, or clears the owner and marks
 * the entry as stash-less when it has none.
 */
export function rememberPrivateParamsOwner(): void {
  if (typeof window === 'undefined') return;
  const id = currentPrivateParamsId();
  lastOwner = id === null ? null : { id, href: window.location.href };
  if (id !== null || currentHistoryState()[NO_STASH_STATE_KEY] === true) return;
  try {
    const { pathname, search, hash } = window.location;
    window.history.replaceState(
      { ...currentHistoryState(), [NO_STASH_STATE_KEY]: true },
      '',
      `${pathname}${search}${hash}`
    );
  } catch {
    // Unmarked entries just stay eligible to inherit; nothing else depends on it.
  }
}

/**
 * Re-stamps the stash id onto the new entry when the user only moved to a
 * fragment of the same page (e.g. the "Skip to main content" link): same path
 * and query, different hash, new entry without an id. It does not apply to any
 * other entry: not a same-URL `pushState`, not another query, not another
 * path, and never across documents.
 */
export function inheritPrivateParamsForFragmentNavigation(): boolean {
  if (typeof window === 'undefined' || lastOwner === null) return false;
  const owner = lastOwner;
  const { href } = window.location;
  const withoutHash = (url: string) => url.split('#', 1)[0];
  const isFragmentMove =
    currentPrivateParamsId() === null &&
    currentHistoryState()[NO_STASH_STATE_KEY] !== true &&
    href !== owner.href &&
    withoutHash(href) === withoutHash(owner.href) &&
    loadRecord(owner.id) !== undefined;
  if (!isFragmentMove) return false;
  try {
    window.history.replaceState(
      stateWithId(owner.id),
      '',
      `${window.location.pathname}${window.location.search}${window.location.hash}`
    );
  } catch {
    return false;
  }
  return true;
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
