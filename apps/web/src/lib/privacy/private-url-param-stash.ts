import {
  canonicalSearch,
  type PrivateEntry,
  partitionSensitiveSearch,
} from './sensitive-url-params';

const STASH_KEY_PREFIX = 'baci:private-url-params:';

interface StashRecord {
  publicSearch: string;
  entries: PrivateEntry[];
}

function stashKey(pathname: string): string {
  return `${STASH_KEY_PREFIX}${pathname}`;
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

/**
 * Moves sensitive query params (order tokens, shopper details) out of the
 * address bar so ad scripts reading `window.location.href` never see them.
 * The values are kept in sessionStorage for this tab. If storage is not
 * available the URL is left untouched so the page keeps working.
 */
export function scrubPrivateParamsFromAddressBar(): boolean {
  if (typeof window === 'undefined') return false;

  const { pathname, search, hash } = window.location;
  const { privateEntries, publicSearch } = partitionSensitiveSearch(search);
  if (privateEntries.length === 0) return false;

  try {
    const record: StashRecord = {
      publicSearch: canonicalSearch(publicSearch),
      entries: privateEntries,
    };
    window.sessionStorage.setItem(stashKey(pathname), JSON.stringify(record));
  } catch {
    return false;
  }

  try {
    window.history.replaceState(
      null,
      '',
      `${pathname}${publicSearch ? `?${publicSearch}` : ''}${hash}`
    );
  } catch {
    return false;
  }
  return true;
}

/**
 * Returns the entries stashed for this path, but only when they were saved for
 * the same remaining query, so a later visit for a different order never
 * inherits an old token.
 */
export function readStashedPrivateParams(
  pathname: string,
  publicSearch: string
): PrivateEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.sessionStorage.getItem(stashKey(pathname));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return [];
    const { publicSearch: storedSearch, entries } = parsed as Record<
      string,
      unknown
    >;
    if (typeof storedSearch !== 'string' || !isEntryList(entries)) return [];
    return storedSearch === canonicalSearch(publicSearch) ? entries : [];
  } catch {
    return [];
  }
}
