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

/**
 * Drop-in replacement for reading `useSearchParams()` on pages that receive
 * order tokens or shopper details in the link.
 *
 * Right after mount it moves those values out of the address bar (so ad scripts
 * reading `window.location.href` never see them) and keeps returning them from
 * a per-tab stash. The returned object keeps the same identity while its
 * contents are unchanged, so effects keyed on it do not re-run when the address
 * bar is rewritten.
 *
 * The stash is read after mount, not during the first render: on a reload the
 * address bar is already clean, and reading storage during the first client
 * render would not match what the server rendered.
 */
export function usePrivateSearchParams(): URLSearchParams {
  const pathname = usePathname();
  const liveSearch = useSearchParams().toString();
  const [stash, setStash] = useState<Stash | null>(null);

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
    const live = partitionSensitiveSearch(liveSearch).publicSearch;
    const entries = readStashedPrivateParams(pathname, live);
    const key = stashKeyFor(pathname, live);
    setStash((previous) => {
      if (entries.length === 0) return previous === null ? previous : null;
      const same =
        previous?.key === key &&
        JSON.stringify(previous.entries) === JSON.stringify(entries);
      return same ? previous : { key, entries };
    });
  }, [pathname, liveSearch]);

  return params;
}
