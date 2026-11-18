import { isEntryList } from './is-entry-list';
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

/**
 * How long a hand-off may wait for the destination page to claim it. Long
 * enough for a slow connection or a cold route, short enough that an unclaimed
 * token does not linger: it is also dropped when the shopper navigates the
 * history instead (see clearPendingPrivateParams) and when read after expiry.
 */
export const PENDING_HANDOFF_TTL_MS = 300_000;

interface PendingHandoff {
  /** Every pathname the destination may be shown under (see acceptedPaths). */
  paths: string[];
  publicSearch: string;
  entries: PrivateEntry[];
  expiresAt: number;
}

function isPendingHandoff(value: unknown): value is PendingHandoff {
  if (typeof value !== 'object' || value === null) return false;
  const { paths, publicSearch, entries, expiresAt } = value as Record<
    string,
    unknown
  >;
  return (
    Array.isArray(paths) &&
    paths.every((path) => typeof path === 'string') &&
    typeof publicSearch === 'string' &&
    typeof expiresAt === 'number' &&
    isEntryList(entries)
  );
}

/** Drops a pending hand-off: the shopper moved through history instead of arriving. */
export function clearPendingPrivateParams(): void {
  try {
    window.sessionStorage.removeItem(PENDING_KEY);
  } catch {
    // Nothing more to clean up.
  }
}

/**
 * The pending record, or null. An expired or malformed record is deleted as
 * soon as it is read, so a token never lingers in sessionStorage.
 */
function readPending(): PendingHandoff | null {
  let raw: string | null;
  try {
    raw = window.sessionStorage.getItem(PENDING_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (isPendingHandoff(parsed) && parsed.expiresAt > Date.now()) {
      return parsed;
    }
  } catch {
    // Malformed: removed below.
  }
  clearPendingPrivateParams();
  return null;
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
    !pending?.paths.includes(pathname) ||
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
  clearPendingPrivateParams();
  return true;
}
