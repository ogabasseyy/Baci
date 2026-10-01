'use client';

import type { SupabaseClient, User } from '@supabase/supabase-js';
import {
  createContext,
  type ReactNode,
  use,
  useEffect,
  useRef,
  useState,
} from 'react';
import { waitForLcpWindowEnd } from '@/lib/posthog/wait-for-lcp';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

// Absolute backstop so a signed-in browser whose stored session is unreadable
// still resolves auth instead of waiting for idle/interaction forever. Mirrors
// the non-scroller backstop precedent used by below-fold gates.
const AUTH_BOOT_BACKSTOP_MS = 8000;

// Short boot fallback for browsers without `requestIdleCallback` (older
// engines, some embedded webviews): with no idle signal, an anonymous
// visitor who never interacts would otherwise sit on `loading=true` for the
// full backstop (e.g. /builder stuck on its loading view instead of
// redirecting signed-out visitors). The 2s timer starts the LCP wait rather
// than booting outright, so auth still resolves far sooner than the
// backstop on those browsers without re-entering the LCP window.
const AUTH_BOOT_NO_IDLE_FALLBACK_MS = 2000;

/**
 * Whether this browser plausibly holds a session (localStorage or cookie).
 * Anything unreadable fails closed to `true` — an unknown state must boot
 * auth immediately, never strand a signed-in user behind the idle gate.
 */
function hasStoredBrowserSession(): boolean {
  try {
    if (typeof window === 'undefined') return true;
    const storage = window.localStorage;
    if (storage) {
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index) ?? '';
        if (key.startsWith('sb-') && key.includes('auth-token')) {
          return true;
        }
      }
    }
    // @supabase/ssr splits large sessions into chunked cookies named
    // `sb-<ref>-auth-token.0` … `.4` (see its cookie `getWithHints`); accept
    // the optional chunk suffix so chunked-only browsers still boot eagerly.
    return (
      typeof document !== 'undefined' &&
      /(?:^|;\s*)sb-[^;]*auth-token(\.\d+)?=/.test(document.cookie ?? '')
    );
  } catch {
    return true;
  }
}

async function loadSupabaseClient(): Promise<SupabaseClient> {
  const { createClient } = await import('@/lib/supabase/client');
  return createClient();
}

/**
 * Runs `start` immediately when a stored session may exist; otherwise defers
 * it off the initial critical path until the browser is idle, the user
 * interacts, or the backstop fires — whichever comes first. Anonymous page
 * loads (the common storefront case) pay zero auth bytes and zero auth
 * network during LCP; the provider keeps reporting signed-out until boot.
 *
 * Idle and timer triggers additionally wait out the LCP window before
 * starting: importing the Supabase client mid-hero-download would re-enter
 * the critical window with chunk download, parsing, and initialization.
 * Interaction still starts immediately (an engaged shopper outranks LCP),
 * and the absolute backstop stays unconditional so auth can never strand
 * behind a wait that never settles.
 */
function scheduleAuthBoot(start: () => void): () => void {
  if (hasStoredBrowserSession()) {
    start();
    return () => undefined;
  }

  let settled = false;
  let idleHandle: number | undefined;
  let backstopTimer: ReturnType<typeof setTimeout> | undefined;

  const cancel = () => {
    settled = true;
    if (idleHandle !== undefined && typeof window !== 'undefined') {
      const ric = (
        window as Window & { cancelIdleCallback?: (id: number) => void }
      ).cancelIdleCallback;
      if (typeof ric === 'function') ric.call(window, idleHandle);
    }
    if (backstopTimer !== undefined) clearTimeout(backstopTimer);
    if (typeof window !== 'undefined') {
      window.removeEventListener('pointerdown', onFirstInteraction);
      window.removeEventListener('keydown', onFirstInteraction);
    }
  };

  function onFirstInteraction() {
    if (settled) return;
    cancel();
    start();
  }

  // Idle and timer triggers wait out the LCP window first; the LCP wait
  // carries its own backstop, so this still resolves when LCP never fires.
  // An interaction (or unmount) that settles first cancels the wait via the
  // `settled` guard — the boot runs exactly once, on the earliest trigger.
  function onDeferredTrigger() {
    if (settled) return;
    void waitForLcpWindowEnd().then(() => {
      if (settled) return;
      cancel();
      start();
    });
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('pointerdown', onFirstInteraction, { once: true });
    window.addEventListener('keydown', onFirstInteraction, { once: true });
    const ric = (
      window as Window & {
        requestIdleCallback?: (
          callback: () => void,
          options?: { timeout: number }
        ) => number;
      }
    ).requestIdleCallback;
    if (typeof ric === 'function') {
      idleHandle = ric.call(window, onDeferredTrigger, {
        timeout: AUTH_BOOT_BACKSTOP_MS,
      });
      backstopTimer = setTimeout(onFirstInteraction, AUTH_BOOT_BACKSTOP_MS);
    } else {
      // No idle API: the short fallback is the only timer. An idle-capable
      // browser resolves at the first idle period instead, so only RIC-less
      // browsers ever wait the (short) fixed delay — now plus the LCP
      // window, still well under the absolute backstop these browsers lack.
      // (/builder-style pages on such browsers resolve auth slightly later
      // on slow LCPs; interaction still boots immediately.)
      backstopTimer = setTimeout(
        onDeferredTrigger,
        AUTH_BOOT_NO_IDLE_FALLBACK_MS
      );
    }
  } else {
    start();
  }

  return cancel;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Hoisted out of the component so React Compiler can lower the effect body
// (try/finally statements are not yet supported inside component/hook bodies).
async function initializeAuthState(
  supabase: SupabaseClient,
  hadInitialUser: boolean,
  onUser: (user: User | null) => void,
  onSettled: () => void
) {
  try {
    const {
      data: { user: refreshedUser },
    } = await supabase.auth.getUser();
    onUser(refreshedUser ?? null);
  } catch (error) {
    console.error('[AuthProvider] Failed to initialize auth state', error);
    if (!hadInitialUser) {
      onUser(null);
    }
  } finally {
    onSettled();
  }
}

export function AuthProvider({
  children,
  initialUser = null,
}: {
  children: ReactNode;
  initialUser?: User | null;
}) {
  const initialUserRef = useRef(initialUser);
  const [user, setUser] = useState<User | null>(initialUser);
  const [loading, setLoading] = useState(!initialUser);

  useEffect(() => {
    let isMounted = true;
    let subscription: { unsubscribe: () => void } | undefined;

    const start = () => {
      void (async () => {
        let supabase: Awaited<ReturnType<typeof loadSupabaseClient>>;
        try {
          supabase = await loadSupabaseClient();
        } catch (error) {
          // A rejected lazy import or factory must settle auth instead of
          // stranding the page on loading=true: without an initialUser there
          // is no other path that clears it. Fail open to signed-out (a
          // reload recovers); a server-supplied initialUser stays intact.
          console.error('[AuthProvider] Failed to load Supabase client', error);
          if (isMounted) {
            setLoading(false);
          }
          return;
        }
        if (!isMounted) return;

        // Listen for auth changes (login, logout, token refresh) without
        // waiting for the refresh below: a hung getUser must never silence
        // live auth events.
        const listener = supabase.auth.onAuthStateChange((_event, session) => {
          setUser(session?.user ?? null);
          setLoading(false);
        });
        if (!isMounted) {
          listener.data.subscription.unsubscribe();
          return;
        }
        subscription = listener.data.subscription;

        // Get initial user - use getUser() instead of getSession() to ensure
        // we get fresh auth state after server-side login redirects.
        // getUser() validates the JWT with Supabase's server, preventing stale states.
        await initializeAuthState(
          supabase,
          Boolean(initialUserRef.current),
          (nextUser) => {
            if (isMounted) {
              setUser(nextUser);
            }
          },
          () => {
            if (isMounted) {
              setLoading(false);
            }
          }
        );
      })();
    };

    const cancelScheduledBoot = scheduleAuthBoot(start);

    return () => {
      isMounted = false;
      cancelScheduledBoot();
      subscription?.unsubscribe();
    };
  }, []);

  const signOut = async () => {
    const supabase = await loadSupabaseClient();
    await supabase.auth.signOut();
  };

  const value = { user, loading, signOut };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = use(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

/**
 * Safe version that returns null instead of throwing when outside AuthProvider
 * Useful for components that may render in preview/demo mode without auth
 */
export function useAuthSafe(): AuthContextType | null {
  const context = use(AuthContext);
  return context ?? null;
}
