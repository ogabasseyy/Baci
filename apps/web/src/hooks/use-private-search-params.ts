'use client'; // Reads the address bar and sessionStorage, so it can only run in the browser.

import { usePathname, useSearchParams } from 'next/navigation';
import { useLayoutEffect, useState, useSyncExternalStore } from 'react';
import {
  claimPendingPrivateParams,
  readPendingPrivateParams,
} from '@/lib/privacy/private-url-param-handoff';
import {
  readStashedPrivateParams,
  scrubPrivateParamsFromAddressBar,
} from '@/lib/privacy/private-url-param-stash';
import {
  canonicalSearch,
  partitionSensitiveSearch,
} from '@/lib/privacy/sensitive-url-params';

export interface PrivateSearchParamsState {
  searchParams: URLSearchParams;
  /**
   * `false` only during the render that hydrates server HTML. Effects that act
   * on the values (start a payment, verify an order, redirect, seed a form)
   * must wait for `true`, otherwise they run once with the stashed values
   * still missing and again with them present.
   */
  isReady: boolean;
}

function subscribeToHistoryTraversal(onChange: () => void): () => void {
  window.addEventListener('popstate', onChange);
  return () => window.removeEventListener('popstate', onChange);
}

function subscribeToNothing(): () => void {
  return () => {
    // Nothing to unsubscribe from: the value never changes after hydration.
  };
}

/**
 * The private values stashed for the CURRENT history entry, as a query string
 * (a primitive, so it is a stable external-store snapshot). It is empty unless
 * `history.state` carries the id of a stash saved for this exact path and
 * remaining query, so another entry at the same URL (a fresh link to the same
 * page, a new `pushState`) never inherits an earlier order's token.
 */
function stashedQuery(pathname: string, liveSearch: string): string {
  const { privateEntries, publicSearch } = partitionSensitiveSearch(liveSearch);
  if (privateEntries.length > 0) return '';
  // A hand-off made by the page that navigated here is read first: the
  // destination renders before Next.js writes its history entry, so the entry
  // (and its stash id) does not exist yet. It only matches this exact path and
  // query, and is claimed (consumed) by the layout effect below.
  const handedOff = readPendingPrivateParams(pathname, publicSearch);
  return new URLSearchParams(
    handedOff.length > 0
      ? handedOff
      : readStashedPrivateParams(pathname, publicSearch)
  ).toString();
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
 * Hydration: on a reload the address bar is already clean, so the server
 * renders (at request time) without the values. The stash is therefore read
 * through `useSyncExternalStore` with an empty server snapshot: the hydrating
 * render matches the server HTML, and the next render, which happens before
 * paint, switches to the stashed values. A render that is not hydrating (client
 * navigation, tests) reads the stash on its first render. `isReady` is `false`
 * only for the hydrating render; consumers gate value-driven effects on it.
 */
export function usePrivateSearchParamsState(): PrivateSearchParamsState {
  const pathname = usePathname();
  const liveSearch = useSearchParams().toString();

  // Re-read on every render (and after every commit, which is when Next.js
  // has written a same-URL `pushState` entry) so a stash is only returned
  // while the current history entry still carries its id.
  const stashed = useSyncExternalStore(
    subscribeToHistoryTraversal,
    () => stashedQuery(pathname, liveSearch),
    () => ''
  );
  const isReady = useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false
  );

  const merged = new URLSearchParams(liveSearch);
  for (const [name, value] of new URLSearchParams(stashed)) {
    merged.append(name, value);
  }

  const mergedKey = canonicalSearch(merged);
  const [held, setHeld] = useState({ key: mergedKey, params: merged });
  let searchParams = held.params;
  if (held.key !== mergedKey) {
    setHeld({ key: mergedKey, params: merged });
    searchParams = merged;
  }

  // Layout effects run before passive effects in the same commit, so the
  // address bar is clean before any page-view tracker fires. (React 19 does not
  // warn about layout effects during server rendering; they are simply skipped.)
  // biome-ignore lint/correctness/useExhaustiveDependencies: pathname and liveSearch are the triggers; the scrub reads window.location
  useLayoutEffect(() => {
    scrubPrivateParamsFromAddressBar();
    claimPendingPrivateParams();
  }, [pathname, liveSearch]);

  return { searchParams, isReady };
}

export function usePrivateSearchParams(): URLSearchParams {
  return usePrivateSearchParamsState().searchParams;
}
