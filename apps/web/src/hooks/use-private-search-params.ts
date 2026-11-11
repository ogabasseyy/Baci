'use client'; // Reads the address bar and sessionStorage, so it can only run in the browser.

import { usePathname, useSearchParams } from 'next/navigation';
import { useLayoutEffect, useState } from 'react';
import {
  readStashedPrivateParams,
  scrubPrivateParamsFromAddressBar,
} from '@/lib/privacy/private-url-param-stash';
import {
  canonicalSearch,
  type PrivateEntry,
  partitionSensitiveSearch,
} from '@/lib/privacy/sensitive-url-params';

interface Stash {
  key: string;
  entries: PrivateEntry[];
}

function stashKeyFor(pathname: string, publicSearch: string): string {
  return `${pathname}?${canonicalSearch(publicSearch)}`;
}

function loadStash(pathname: string, liveSearch: string): Stash | null {
  if (typeof window === 'undefined') return null;
  const { privateEntries, publicSearch } = partitionSensitiveSearch(liveSearch);
  if (privateEntries.length > 0) return null;
  const entries = readStashedPrivateParams(pathname, publicSearch);
  return entries.length > 0
    ? { key: stashKeyFor(pathname, publicSearch), entries }
    : null;
}

/**
 * Drop-in replacement for reading `useSearchParams()` on pages that receive
 * order tokens or shopper details in the link.
 *
 * Right after mount it moves those values out of the address bar (so ad scripts
 * reading `window.location.href` never see them) and keeps returning them from
 * a per-tab stash tied to the current history entry (see
 * private-url-param-stash.ts; Next.js keeps the custom `history.state` key on
 * reload and back/forward). The returned object keeps the same identity while
 * its contents are unchanged, so effects keyed on it do not re-run when the
 * address bar is rewritten.
 *
 * On a reload the address bar is already clean, so the stash is read
 * synchronously during the first client render (never on the server). That way
 * no consumer effect ever sees the token/email/phone/name as missing and then
 * present, which would run payment or lookup effects twice. The trade-off: the
 * server renders a reloaded page without the values, so markup that prints
 * them directly can differ at hydration (React recovers by client-rendering
 * it). Running payment effects with missing values is worse, so this was
 * chosen on purpose.
 */
function syncStash(
  previous: Stash | null,
  pathname: string,
  liveSearch: string
): Stash | null {
  const next = loadStash(
    pathname,
    partitionSensitiveSearch(liveSearch).publicSearch
  );
  if (next === null) return previous === null ? previous : null;
  const same =
    previous?.key === next.key &&
    JSON.stringify(previous.entries) === JSON.stringify(next.entries);
  return same ? previous : next;
}

export function usePrivateSearchParams(): URLSearchParams {
  const pathname = usePathname();
  const liveSearch = useSearchParams().toString();
  const [stash, setStash] = useState<Stash | null>(() =>
    loadStash(pathname, liveSearch)
  );

  const { privateEntries, publicSearch } = partitionSensitiveSearch(liveSearch);
  const merged = new URLSearchParams(liveSearch);
  if (
    privateEntries.length === 0 &&
    stash &&
    stash.key === stashKeyFor(pathname, publicSearch)
  ) {
    for (const [name, value] of stash.entries) merged.append(name, value);
  }

  const mergedKey = canonicalSearch(merged);
  const [held, setHeld] = useState({ key: mergedKey, params: merged });
  let params = held.params;
  if (held.key !== mergedKey) {
    setHeld({ key: mergedKey, params: merged });
    params = merged;
  }

  // Layout effects run before passive effects in the same commit, so the
  // address bar is clean before any page-view tracker fires.
  useLayoutEffect(() => {
    scrubPrivateParamsFromAddressBar();
    setStash((previous) => syncStash(previous, pathname, liveSearch));

    // Back/forward can land on another history entry of the same page without
    // changing the path or the query, so re-read that entry's stash.
    const onPopState = () =>
      setStash((previous) => syncStash(previous, pathname, liveSearch));
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [pathname, liveSearch]);

  return params;
}
