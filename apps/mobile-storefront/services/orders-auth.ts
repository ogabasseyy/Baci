import {
  isAuthRefreshDiscardedError,
  type Session,
} from '@supabase/supabase-js';
import { createLogger } from '@/lib/logger';

const log = createLogger('Order');
// The auth transport permits an immediate recovery attempt after its first
// four-second deadline. Keep checkout bounded while allowing both attempts.
const CHECKOUT_SESSION_REFRESH_TIMEOUT_MS = 9_000;

type CheckoutAuth = {
  refreshSession: (currentSession?: {
    refresh_token: string;
    bypass_failure_cache?: boolean;
    require_storage_match?: boolean;
    storage_deadline_at?: number;
  }) => Promise<{
    data: { session: Session | null };
    error: Error | null;
  }>;
};

function refreshTimeout(timeoutMs: number): {
  promise: Promise<never>;
  timer: ReturnType<typeof setTimeout> | undefined;
} {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const promise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error('Checkout session refresh timed out')),
      timeoutMs
    );
  });

  return { promise, timer };
}

type CheckoutAuthResult = {
  authorizationHeaders: Record<string, string>;
  canValidateUser: boolean;
  session: Session | null;
};

function checkoutAuthResult(
  session: Session | null,
  canValidateUser: boolean
): CheckoutAuthResult {
  return {
    authorizationHeaders: session?.access_token
      ? { Authorization: `Bearer ${session.access_token}` }
      : {},
    canValidateUser,
    session,
  };
}

export async function resolveCheckoutAuth(
  auth: CheckoutAuth,
  storedSession: Session | null,
  timeoutMs = CHECKOUT_SESSION_REFRESH_TIMEOUT_MS,
  readCurrentSession?: () => Promise<Session | null>
): Promise<CheckoutAuthResult> {
  if (!storedSession) return checkoutAuthResult(null, false);

  const refresh = auth.refreshSession({
    bypass_failure_cache: true,
    refresh_token: storedSession.refresh_token,
    require_storage_match: true,
    storage_deadline_at: Date.now() + timeoutMs,
  });
  const timeout = refreshTimeout(timeoutMs);
  try {
    const { data, error } = await Promise.race([refresh, timeout.promise]);
    if (isAuthRefreshDiscardedError(error)) {
      const currentSession = await readCurrentSession?.();
      const sessionRotated =
        currentSession?.access_token !== storedSession.access_token ||
        currentSession?.refresh_token !== storedSession.refresh_token;
      if (currentSession?.user.id === storedSession.user.id && sessionRotated) {
        log.warn(
          'Checkout session rotated during refresh; using the current session'
        );
        return checkoutAuthResult(currentSession, true);
      }

      log.warn(
        'Checkout session refresh was discarded; omitting stale session'
      );
      return checkoutAuthResult(null, false);
    }

    if (data.session && storedSession.user.id !== data.session.user.id) {
      log.warn(
        'Checkout session identity changed during refresh; omitting authorization'
      );
      return checkoutAuthResult(null, false);
    }

    if (error || !data.session) {
      log.warn('Unable to refresh checkout session; omitting authorization', {
        error: error?.message ?? 'Refresh returned no session',
      });
      return checkoutAuthResult(null, false);
    }

    return checkoutAuthResult(data.session, true);
  } catch (error) {
    log.warn('Unable to refresh checkout session; omitting authorization', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return checkoutAuthResult(null, false);
  } finally {
    if (timeout.timer) clearTimeout(timeout.timer);
  }
}
