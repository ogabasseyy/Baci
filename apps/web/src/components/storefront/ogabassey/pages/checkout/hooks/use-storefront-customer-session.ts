'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

/**
 * Three-state resolution for the storefront cookie session:
 * - `loading`  — the initial fetch (or a post-auth-change refresh) is in flight.
 *   MUST NOT be collapsed into `guest`: doing so routes a signed-in customer who
 *   submits promptly after page load down the legacy order-DVA path.
 * - `authenticated` / `guest` — the settled outcome once the fetch resolves.
 */
export type StorefrontCustomerSessionStatus =
  | 'loading'
  | 'authenticated'
  | 'guest';

interface StorefrontSessionResponse {
  authenticated?: boolean;
}

// A dropped connection can leave the session fetch hanging (stalled, not
// rejected) rather than failing, which would pin the checkout gate on `loading`
// forever. Bound the request so a stall aborts and fails closed to guest — the
// intent API stays the real authority, so a stale guest only defers to legacy.
const SESSION_REQUEST_TIMEOUT_MS = 12_000;

async function fetchSessionAuthenticated(
  merchantSlug: string,
  signal: AbortSignal
): Promise<boolean> {
  const response = await fetch(
    `/api/storefront/auth/session?merchantSlug=${encodeURIComponent(merchantSlug)}`,
    // Combine the supersede/unmount controller with a hard timeout so neither a
    // newer auth transition nor a stalled connection can leave this hanging.
    {
      signal: AbortSignal.any([
        signal,
        AbortSignal.timeout(SESSION_REQUEST_TIMEOUT_MS),
      ]),
    }
  );
  if (!response.ok) {
    return false;
  }
  const data = (await response.json()) as StorefrontSessionResponse | null;
  return Boolean(data?.authenticated);
}

// Module scope so the try/catch stays out of the effect body, where it would
// otherwise block React Compiler memoization (same pattern as the sibling
// polling hook). Fail-closed: an unreachable session resolves to guest.
async function loadSessionAuthenticated(
  merchantSlug: string,
  signal: AbortSignal
): Promise<boolean> {
  try {
    return await fetchSessionAuthenticated(merchantSlug, signal);
  } catch {
    return false;
  }
}

export interface StorefrontCustomerSession {
  status: StorefrontCustomerSessionStatus;
  revision: number;
  /** Derived convenience flag — false while `loading`. */
  isAuthenticated: boolean;
  /**
   * Resolves with the authoritative signed-in value, awaiting the in-flight
   * session fetch when the status is still `loading`. Callers on the real-money
   * checkout path MUST await this before choosing wallet-funded vs legacy DVA so
   * a slow session fetch never mis-routes a signed-in customer to the guest path.
   */
  waitForResolvedAuthenticated: () => Promise<boolean>;
}

/**
 * Resolves whether a storefront customer is signed in on routes that do NOT
 * mount `CustomerAuthProvider` — the `(commerce)` checkout route is one, so
 * `useAuthSafe()`/`useCustomerAuth()` are both null there. Mirrors the storefront
 * header, which reads the cookie session directly via `/api/storefront/auth/session`.
 *
 * This is the correct client-side gate source for the wallet-funded transfer
 * flow: the intent API remains the real authority (it 401/409s guests), so a
 * stale `false` only defers to the legacy order-DVA path — it never claims payment.
 *
 * A guest who signs in mid-checkout (e.g. via `CheckoutAuthModal`, which calls
 * `supabase.auth.signInWithPassword`, or by creating an account during checkout)
 * must not stay pinned to the guest gate. We subscribe to Supabase
 * `onAuthStateChange` — the same login signal `AuthContext` listens to — and
 * re-fetch the server session on every auth transition so the gate reflects the
 * new state. Fail-closed is preserved: a failed refresh resets to guest.
 */
export function useStorefrontCustomerSession(
  merchantSlug: string | undefined
): StorefrontCustomerSession {
  const [status, setStatus] = useState<StorefrontCustomerSessionStatus>(
    merchantSlug ? 'loading' : 'guest'
  );
  const [revision, setRevision] = useState(0);
  const revisionRef = useRef(0);
  // Latest in-flight (or settled) resolution promise. A checkout submit that
  // fires before the session resolves awaits THIS instead of racing the initial
  // `loading` state down the guest branch.
  const pendingRef = useRef<Promise<boolean>>(Promise.resolve(false));

  useEffect(() => {
    const advanceRevision = () => {
      revisionRef.current += 1;
      setRevision(revisionRef.current);
    };

    if (!merchantSlug) {
      advanceRevision();
      pendingRef.current = Promise.resolve(false);
      setStatus('guest');
      return;
    }

    let activeController: AbortController | null = null;

    const runLoad = () => {
      // Supersede any in-flight request so a slow earlier fetch can't clobber
      // the result of a newer auth transition.
      activeController?.abort();
      const controller = new AbortController();
      activeController = controller;
      advanceRevision();
      setStatus('loading');
      const pending = loadSessionAuthenticated(merchantSlug, controller.signal);
      pendingRef.current = pending;
      void pending.then((authenticated) => {
        if (controller.signal.aborted) {
          return;
        }
        setStatus(authenticated ? 'authenticated' : 'guest');
      });
    };

    // Initial evaluation on mount / merchant change.
    runLoad();

    // Re-evaluate whenever auth changes mid-checkout. INITIAL_SESSION is the
    // subscribe-time replay and is already covered by the explicit runLoad above,
    // so skip it to avoid a duplicate request.
    const supabase = createClient();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'INITIAL_SESSION') {
        return;
      }
      runLoad();
    });

    return () => {
      activeController?.abort();
      subscription.unsubscribe();
    };
  }, [merchantSlug]);

  const waitForResolvedAuthenticated = () => pendingRef.current;

  return {
    status,
    revision,
    isAuthenticated: status === 'authenticated',
    waitForResolvedAuthenticated,
  };
}
