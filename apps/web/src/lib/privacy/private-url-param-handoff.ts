import {
  currentPrivateParamsId,
  stashEntriesOnCurrentEntry,
} from './private-url-param-stash';
import {
  canonicalSearch,
  type PrivateEntry,
  partitionSensitiveSearch,
} from './sensitive-url-params';

const PENDING_KEY = 'baci:private-url-params-pending';

/** How long a hand-off may wait for the destination page to claim it. */
export const PENDING_HANDOFF_TTL_MS = 60_000;

interface PendingHandoff {
  /** Every pathname the destination may be shown under (see acceptedPaths). */
  paths: string[];
  publicSearch: string;
  entries: PrivateEntry[];
  expiresAt: number;
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

function readPending(): PendingHandoff | null {
  try {
    const raw = window.sessionStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingHandoff> | null;
    if (
      !Array.isArray(parsed?.paths) ||
      !parsed.paths.every((path) => typeof path === 'string') ||
      typeof parsed.publicSearch !== 'string' ||
      typeof parsed.expiresAt !== 'number' ||
      !isEntryList(parsed.entries)
    ) {
      return null;
    }
    return parsed as PendingHandoff;
  } catch {
    return null;
  }
}

function clearPending(): void {
  try {
    window.sessionStorage.removeItem(PENDING_KEY);
  } catch {
    // Nothing more to clean up; the record expires on its own.
  }
}

/**
 * The paths one page can be visible under. On a merchant custom domain the
 * proxy redirects `/<slug>/page` to `/page` (and serves `/page` through an
 * internal rewrite), so the same page appears with or without the storefront
 * slug prefix. Only that prefix is ignored: a different page never matches.
 */
function acceptedPaths(pathname: string, slug: string): string[] {
  const prefix = `/${slug}`;
  const hasPrefix =
    pathname.toLowerCase() === prefix.toLowerCase() ||
    pathname.toLowerCase().startsWith(`${prefix.toLowerCase()}/`);
  if (hasPrefix) return [pathname, pathname.slice(prefix.length) || '/'];
  return [pathname, `${prefix}${pathname === '/' ? '' : pathname}`];
}

/**
 * Prepares an in-app navigation that would otherwise put order tokens or
 * shopper details in the address bar. The private values are stored for the
 * destination (bound to its path and remaining query, valid for about a
 * minute) and the returned href has them removed: navigate to that instead.
 *
 * The clean href is only returned when the destination can be matched for
 * certain: the storefront `slug` must be known (the destination may be shown
 * with or without it). If the href has nothing private, points to another
 * origin, the slug is unknown, or the values cannot be stored, the original
 * href is returned unchanged so a paid order is never stranded without its
 * token; the destination then scrubs on arrival.
 */
export function stashPrivateParamsForNavigation(
  targetHref: string,
  slug: string | null | undefined
): string {
  if (!slug) return targetHref;
  if (typeof window === 'undefined') return targetHref;
  let url: URL;
  try {
    url = new URL(targetHref, window.location.href);
  } catch {
    return targetHref;
  }
  if (url.origin !== window.location.origin) return targetHref;
  const { privateEntries, publicSearch } = partitionSensitiveSearch(url.search);
  if (privateEntries.length === 0) return targetHref;
  const pending: PendingHandoff = {
    paths: acceptedPaths(url.pathname, slug),
    publicSearch: canonicalSearch(publicSearch),
    entries: privateEntries,
    expiresAt: Date.now() + PENDING_HANDOFF_TTL_MS,
  };
  try {
    window.sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
  } catch {
    return targetHref;
  }
  return `${url.pathname}${publicSearch ? `?${publicSearch}` : ''}${url.hash}`;
}

/**
 * The pending hand-off values, only when it is not expired and was made for
 * exactly this path and remaining query. Reading does not consume it: the
 * destination's first render happens before its history entry exists, so it
 * must be readable until `claimPendingPrivateParams` runs.
 */
export function readPendingPrivateParams(
  pathname: string,
  publicSearch: string
): PrivateEntry[] {
  if (typeof window === 'undefined') return [];
  const pending = readPending();
  if (
    !pending ||
    pending.expiresAt <= Date.now() ||
    !pending.paths.includes(pathname) ||
    pending.publicSearch !== canonicalSearch(publicSearch)
  ) {
    return [];
  }
  return pending.entries;
}

/**
 * Turns a matching pending hand-off into the stash of the CURRENT history
 * entry (so reload and back/forward keep working) and deletes it, so it is
 * used exactly once. Does nothing when the entry already has a stash, the
 * address still carries private params, or nothing matches.
 */
export function claimPendingPrivateParams(): boolean {
  if (typeof window === 'undefined') return false;
  if (currentPrivateParamsId() !== null) return false;
  const { pathname, search } = window.location;
  const { privateEntries, publicSearch } = partitionSensitiveSearch(search);
  if (privateEntries.length > 0) return false;
  const entries = readPendingPrivateParams(pathname, publicSearch);
  if (entries.length === 0) return false;
  if (!stashEntriesOnCurrentEntry(entries, pathname, publicSearch)) {
    return false;
  }
  clearPending();
  return true;
}
