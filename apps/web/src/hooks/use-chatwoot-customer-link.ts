import { useEffect } from 'react';
import { subscribeCustomerIdentityInvalidation } from '@/contexts/customer-identity-invalidation';
import {
  getLiveCustomerIdentity,
  subscribeCustomerIdentityChange,
} from '@/contexts/customer-live-identity';
import { readCustomerSessionHint } from '@/contexts/customer-session-hint';
import { fetchWithCsrf } from '@/lib/api-client';
import { CHAT_CUSTOMER_LINK_ATTRIBUTE } from '@/schemas/chat-customer-link';
import { readLinkMarker, writeLinkMarker } from './chat-link-marker';

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
    let cancelled = false;
    // Each sync gets a number; only the newest may act on its answer.
    let generation = 0;
    let lastSyncAt = 0;
    let guestCleared = false;
    let trailing: ReturnType<typeof setTimeout> | undefined;
    const cancelTrailing = () => {
      if (trailing !== undefined) clearTimeout(trailing);
      trailing = undefined;
    };
    let lastHint = readCustomerSessionHint();
    // The widget removes the note with a request of its own and gives no answer
    // to wait for. When that is sent with the browser offline it is lost, so it
    // is sent again once the browser is back (see `onOnline`).
    let pendingRemoval = false;

    // `force` is for a sign-out we just saw happen: remove the note even if no
    // marker survived (blocked storage), since a note may well be attached.
    const clearLink = (force = false) => {
      if (
        !force &&
        !readLinkMarker(storeSlug) &&
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
      writeLinkMarker(storeSlug, false);
      pendingRemoval =
        typeof navigator !== 'undefined' && navigator.onLine === false;
    };

    const onOnline = () => {
      if (cancelled) return;
      if (pendingRemoval) {
        pendingRemoval = false;
        // Only while still a guest: a shopper who signed in again gets a fresh
        // note from the check that follows the sign-in.
        if (readCustomerSessionHint() !== '1') clearLink(true);
      }
      // A signed-in shopper whose check failed while offline was never linked:
      // ask again now, instead of waiting for a focus, another tab or a reload.
      if (
        readCustomerSessionHint() === '1' &&
        !linkedThisSession.has(storeSlug)
      ) {
        void sync('recheck');
      }
    };
    window.addEventListener('online', onOnline);

    /**
     * `initial`: the chat just loaded and we cannot tell whether the account
     * changed since the note was set, so a failed check removes a recorded note
     * rather than trust it (a visitor who was never linked costs nothing).
     * `identity-change`: we know the account changed, so the previous account's
     * note is removed before the new one is requested, never left in place.
     * `recheck`: we cannot tell if the account changed (a focus or cross-tab
     * notice), so a failed check removes the note rather than trust it.
     */
    const sync = async (mode: 'initial' | 'identity-change' | 'recheck') => {
      const mine = ++generation;
      lastSyncAt = Date.now();
      const stale = () => cancelled || mine !== generation;
      const hint = readCustomerSessionHint();
      if (hint !== '1') {
        // An explicit guest hint means the shopper signed out (or never was
        // one): remove any note even if the "linked" marker was lost, once per
        // page load. With no hint at all, only a recorded link is removed, so a
        // visitor who was never linked costs no request.
        if (hint === '0' && !guestCleared) {
          guestCleared = true;
          clearLink(true);
        } else {
          clearLink();
        }
        return;
      }
      if (mode === 'identity-change') clearLink(true);
      // A note that cannot be confirmed may belong to a previous account, so it
      // is removed. After the first check only a recorded link is touched.
      const failClosed = () => {
        if (!stale()) clearLink(mode !== 'initial');
      };
      try {
        const response = await fetchWithCsrf(LINK_ENDPOINT, {
          method: 'POST',
          body: JSON.stringify({ storeSlug }),
        });
        if (stale()) return;
        if (response.status === 401 || response.status === 404) {
          // The server says there is no session: nothing may stay linked.
          clearLink(true);
          return;
        }
        if (!response.ok) {
          failClosed();
          return;
        }
        const body: unknown = await response.json();
        const token =
          body !== null && typeof body === 'object'
            ? (body as { token?: unknown }).token
            : undefined;
        if (stale()) return;
        if (typeof token !== 'string' || !token) {
          failClosed();
          return;
        }
        chatwoot()?.setCustomAttributes?.({
          [CHAT_CUSTOMER_LINK_ATTRIBUTE]: token,
        });
        linkedThisSession.add(storeSlug);
        writeLinkMarker(storeSlug, true);
      } catch {
        // Linking is a convenience; the chat works the same without it.
        failClosed();
      }
    };

    void sync('initial');
    const unsubscribe = subscribeCustomerIdentityChange(() => {
      const live = getLiveCustomerIdentity();
      if (!live.userId && !live.customerId) {
        // Signed out: drop any request in flight and remove the note now.
        generation++;
        clearLink(true);
        return;
      }
      void sync('identity-change');
    });
    // Another tab signed out or switched account: the cookies are shared, so
    // the session hint and the server session already show the new state.
    const crossTab = subscribeCustomerIdentityInvalidation(() => {
      const hint = readCustomerSessionHint();
      const changed = hint !== lastHint;
      lastHint = hint;
      if (hint !== '1') {
        cancelTrailing();
        generation++;
        clearLink(true);
        return;
      }
      const wait = RESYNC_MIN_MS - (Date.now() - lastSyncAt);
      if (changed || wait <= 0) {
        cancelTrailing();
        void sync(changed ? 'identity-change' : 'recheck');
        return;
      }
      // Too soon to ask again, but the notice may be a real account switch
      // (the hint stays '1'): drop any answer still in flight, which may belong
      // to the account just left, and check once the window has passed.
      generation++;
      if (trailing === undefined) {
        trailing = setTimeout(() => {
          trailing = undefined;
          void sync('recheck');
        }, wait);
      }
    });
    return () => {
      cancelled = true;
      cancelTrailing();
      window.removeEventListener('online', onOnline);
      unsubscribe();
      crossTab.unsubscribe();
    };
  }, [enabled, storeSlug]);
}
