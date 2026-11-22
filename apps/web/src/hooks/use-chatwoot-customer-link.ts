import { useEffect } from 'react';
import { subscribeCustomerIdentityInvalidation } from '@/contexts/customer-identity-invalidation';
import {
  getLiveCustomerIdentity,
  subscribeCustomerIdentityChange,
} from '@/contexts/customer-live-identity';
import { readCustomerSessionHint } from '@/contexts/customer-session-hint';
import { fetchWithCsrf } from '@/lib/api-client';
import { CHAT_CUSTOMER_LINK_ATTRIBUTE } from '@/schemas/chat-customer-link';

type ChatwootContactApi = {
  setCustomAttributes?: (attributes: Record<string, string>) => void;
  deleteCustomAttribute?: (key: string) => void;
};

const LINK_ENDPOINT = '/api/storefront/chatwoot/customer-link';
/** Focus and cross-tab notices come in bursts; resync at most this often. */
const RESYNC_MIN_MS = 10_000;

/**
 * Stores whose chat link was set during this page's life. The persisted marker
 * is the cross-page record, but storage can be blocked or full, so sign-out
 * must not depend on it.
 */
const linkedThisSession = new Set<string>();

function chatwoot(): ChatwootContactApi | undefined {
  return (window as Window & { $chatwoot?: ChatwootContactApi }).$chatwoot;
}

function readMarker(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeMarker(key: string, linked: boolean): void {
  try {
    if (linked) window.localStorage.setItem(key, '1');
    else window.localStorage.removeItem(key);
  } catch {
    // Private mode or blocked storage: the link still works for this visit.
  }
}

/**
 * When a signed-in shopper has the store chat open, tells the chat who they
 * are with a server-signed note, so the owner sees their orders next to the
 * conversation. Guests cost nothing: with no session hint no request is made.
 *
 * It follows the shopper while the page stays open: signing in adds the note,
 * signing out removes it, switching accounts replaces it. A request still in
 * flight when the identity changes is dropped, so an old answer can never
 * overwrite the new state. Changes made in another tab are followed too.
 */
export function useChatwootCustomerLink(
  storeSlug: string | undefined,
  enabled: boolean
): void {
  useEffect(() => {
    if (!enabled || !storeSlug) return;
    const markerKey = `baci-chat-link:${storeSlug}`;
    let cancelled = false;
    // Each sync gets a number; only the newest may act on its answer.
    let generation = 0;
    let lastSyncAt = 0;
    let lastHint = readCustomerSessionHint();

    // `force` is for a sign-out we just saw happen: remove the note even if no
    // marker survived (blocked storage), since a note may well be attached.
    const clearLink = (force = false) => {
      if (
        !force &&
        !readMarker(markerKey) &&
        !linkedThisSession.has(storeSlug)
      ) {
        return;
      }
      try {
        chatwoot()?.deleteCustomAttribute?.(CHAT_CUSTOMER_LINK_ATTRIBUTE);
      } catch {
        // The widget may be mid-reload; the next load tries again.
        return;
      }
      linkedThisSession.delete(storeSlug);
      writeMarker(markerKey, false);
    };

    const sync = async () => {
      const mine = ++generation;
      lastSyncAt = Date.now();
      const stale = () => cancelled || mine !== generation;
      if (readCustomerSessionHint() !== '1') {
        clearLink();
        return;
      }
      try {
        const response = await fetchWithCsrf(LINK_ENDPOINT, {
          method: 'POST',
          body: JSON.stringify({ storeSlug }),
        });
        if (stale()) return;
        if (response.status === 401 || response.status === 404) {
          clearLink();
          return;
        }
        if (!response.ok) return;
        const body: unknown = await response.json();
        const token =
          body !== null && typeof body === 'object'
            ? (body as { token?: unknown }).token
            : undefined;
        if (stale() || typeof token !== 'string' || !token) return;
        chatwoot()?.setCustomAttributes?.({
          [CHAT_CUSTOMER_LINK_ATTRIBUTE]: token,
        });
        linkedThisSession.add(storeSlug);
        writeMarker(markerKey, true);
      } catch {
        // Linking is a convenience; the chat works the same without it.
      }
    };

    void sync();
    const unsubscribe = subscribeCustomerIdentityChange(() => {
      const live = getLiveCustomerIdentity();
      if (!live.userId && !live.customerId) {
        // Signed out: drop any request in flight and remove the note now.
        generation++;
        clearLink(true);
        return;
      }
      void sync();
    });
    // Another tab signed out or switched account: the cookies are shared, so
    // the session hint and the server session already show the new state.
    const crossTab = subscribeCustomerIdentityInvalidation(() => {
      const hint = readCustomerSessionHint();
      const changed = hint !== lastHint;
      lastHint = hint;
      if (hint !== '1') {
        generation++;
        clearLink(true);
        return;
      }
      if (changed || Date.now() - lastSyncAt >= RESYNC_MIN_MS) void sync();
    });
    return () => {
      cancelled = true;
      unsubscribe();
      crossTab.unsubscribe();
    };
  }, [enabled, storeSlug]);
}
