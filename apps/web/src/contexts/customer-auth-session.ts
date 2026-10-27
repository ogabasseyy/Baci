import { reconcileOrphanedDeferredCartLogout } from '@/hooks/cart/cart-deferred-logout';
import { CART_REQUEST_TIMEOUT_MS } from '@/hooks/cart/cart-request-deadline';
import { beginCartSessionRetirement } from '@/hooks/cart/cart-session-write-fence';
// Session load/logout orchestration for the storefront customer auth provider.
//
// Extracted from `customer-auth-context.tsx` so the provider stays focused on
// React state while this module owns the session fetch, the setter fan-out,
// the live-identity publish, and the cart clear. The try/catch/finally control
// flow stays at module scope so the provider remains React-Compiler friendly.
//
// The type imports below are type-only (erased at compile time); there is no
// runtime cycle back into the context module.
import { eraseRetiredCartCache } from '@/hooks/cart/retired-cart-cache';
import {
  beginDeferredCartLogout,
  cancelDeferredCartLogout,
  clearCartDeviceRevocationPending,
  clearCartDeviceSessionActive,
  endDeferredCartLogout,
  markCartDeviceRevocationPending,
  revokeCartDeviceSession,
} from '@/hooks/cart/shared-cart-session-revoke-client';
import { bumpCartSessionGeneration } from '@/hooks/cart/shared-cart-storage';
import { clearCartStorage } from '@/hooks/use-cart';
import type { Customer, CustomerUser, OtpState } from './customer-auth-context';
import { retirePreviousAccountCartAuthority } from './customer-auth-retirement';
import {
  clearCustomerAuthRollbackPending,
  getRememberedCustomerUserId,
  isCustomerAuthRollbackPending,
  resetRememberedCustomerSessionsForTests,
  rollbackCustomerAuthSession,
  setRememberedCustomerUserId,
} from './customer-auth-storage';
import { publishCustomerIdentity } from './customer-live-identity';

export { resetRememberedCustomerSessionsForTests };

interface CustomerSession {
  customer: Customer;
  user: CustomerUser;
}

type CustomerSessionFetchResult =
  | { status: 'authenticated'; session: CustomerSession }
  | { status: 'unauthenticated' }
  | { status: 'lookup_failed'; userId: string | null };

async function fetchCustomerSession(
  merchantSlug: string
): Promise<CustomerSessionFetchResult> {
  const response = await fetch(
    `/api/storefront/auth/session?merchantSlug=${encodeURIComponent(merchantSlug)}`
  );
  if (response.ok === false) {
    return { status: 'lookup_failed', userId: null };
  }
  const data = (await response.json()) as {
    authenticated?: boolean;
    customer?: Customer;
    user?: CustomerUser;
  };

  if (data.authenticated === false) {
    return { status: 'unauthenticated' };
  }
  if (!data.authenticated || !data.user || !data.customer) {
    return { status: 'lookup_failed', userId: data.user?.id ?? null };
  }

  return {
    status: 'authenticated',
    session: {
      customer: data.customer,
      user: data.user,
    },
  };
}

interface SessionSetters {
  currentUserId?: string | null;
  setUser: (user: CustomerUser | null) => void;
  setCustomer: (customer: Customer | null) => void;
  setIsLoading: (loading: boolean) => void;
}

// Module-scope helper so the try/catch/finally control flow lives outside the
// component body, keeping the provider compilable by the React Compiler.
export async function loadCustomerSession(
  merchantSlug: string,
  { currentUserId, setUser, setCustomer, setIsLoading }: SessionSetters,
  isCancelled: () => boolean = () => false
): Promise<void> {
  const previousUserId = getRememberedCustomerUserId(
    merchantSlug,
    currentUserId
  );
  // A page that closed mid-logout leaves a deferred marker behind;
  // drop it once its lease expires so it cannot fence this load.
  reconcileOrphanedDeferredCartLogout(merchantSlug);
  try {
    if (isCustomerAuthRollbackPending(merchantSlug)) {
      if (previousUserId) {
        await retirePreviousAccountCartAuthority(merchantSlug, previousUserId);
        if (isCancelled()) return;
      }
      await rollbackCustomerAuthSession(merchantSlug);
      if (isCancelled()) return;
      setUser(null);
      setCustomer(null);
      publishCustomerIdentity(null, null, merchantSlug);
      return;
    }

    const result = await fetchCustomerSession(merchantSlug);
    if (isCancelled()) return;

    if (result.status === 'authenticated') {
      const { session } = result;
      if (previousUserId && previousUserId !== session.user.id) {
        const retired = await retirePreviousAccountCartAuthority(
          merchantSlug,
          previousUserId
        );
        if (isCancelled()) return;
        if (!retired) {
          // Mirror commitCustomerAuthSession: clearing React state
          // is not enough, because the browser already holds the new
          // account's auth cookie. Roll the auth session back so a
          // later session-aware page cannot authenticate the new
          // customer while the old cart authority is unretired.
          await rollbackCustomerAuthSession(merchantSlug);
          if (isCancelled()) return;
          setUser(null);
          setCustomer(null);
          publishCustomerIdentity(null, null, merchantSlug);
          return;
        }
      }
      setRememberedCustomerUserId(merchantSlug, session.user.id);
      setUser(session.user);
      setCustomer(session.customer);
      publishCustomerIdentity(session.user, session.customer, merchantSlug);
    } else {
      if (
        previousUserId &&
        (result.status === 'unauthenticated' ||
          (result.userId !== null && result.userId !== previousUserId))
      ) {
        await retirePreviousAccountCartAuthority(merchantSlug, previousUserId);
        if (isCancelled()) return;
      }
      setUser(null);
      setCustomer(null);
      publishCustomerIdentity(null, null, merchantSlug);
    }
  } catch (error) {
    if (isCancelled()) return;
    console.error('Session check error:', error);
    setUser(null);
    setCustomer(null);
    publishCustomerIdentity(null, null, merchantSlug);
  } finally {
    if (!isCancelled()) setIsLoading(false);
  }
}

export async function commitCustomerAuthSession(
  merchantSlug: string,
  session: CustomerSession,
  {
    currentUserId,
    setUser,
    setCustomer,
    setOtpState,
  }: {
    currentUserId?: string | null;
    setUser: (user: CustomerUser | null) => void;
    setCustomer: (customer: Customer | null) => void;
    setOtpState: (otp: OtpState | null) => void;
  }
): Promise<boolean> {
  const previousUserId = getRememberedCustomerUserId(
    merchantSlug,
    currentUserId
  );
  if (previousUserId && previousUserId !== session.user.id) {
    const retired = await retirePreviousAccountCartAuthority(
      merchantSlug,
      previousUserId
    );
    if (!retired) {
      await rollbackCustomerAuthSession(merchantSlug);
      setUser(null);
      setCustomer(null);
      publishCustomerIdentity(null, null, merchantSlug);
      return false;
    }
  }
  clearCustomerAuthRollbackPending(merchantSlug);
  setRememberedCustomerUserId(merchantSlug, session.user.id);
  setUser(session.user);
  setCustomer(session.customer);
  publishCustomerIdentity(session.user, session.customer, merchantSlug);
  setOtpState(null);
  return true;
}

// Module-scope helper for logout so its try/catch/finally stays outside render.
export async function performCustomerLogout(
  merchantSlug: string,
  setUser: (user: CustomerUser | null) => void,
  setCustomer: (customer: Customer | null) => void,
  setOtpState: (otp: OtpState | null) => void,
  userId?: string | null
): Promise<void> {
  const previousUserId = getRememberedCustomerUserId(merchantSlug, userId);
  const retirement = beginCartSessionRetirement(merchantSlug);
  markCartDeviceRevocationPending?.(merchantSlug);
  // The deferred marker keeps concurrent lifecycle passes from
  // clearing this revocation (and erasing the parked cache) before
  // the auth logout commits.
  beginDeferredCartLogout?.(merchantSlug);
  bumpCartSessionGeneration({ merchantSlug });
  let revokedOk = false;
  try {
    const revoked = await retirement.drained
      .then(() =>
        revokeCartDeviceSession(merchantSlug, {
          deferCacheErasure: true,
          retiringUserId: previousUserId ?? userId,
        })
      )
      .catch(() => ({ ok: false }));
    if (!revoked.ok)
      throw new Error(
        'Could not safely sign out. Please retry when connected.'
      );
    revokedOk = true;
    let response: Response;
    try {
      response = await fetch('/api/storefront/auth/logout', {
        method: 'POST',
        signal:
          typeof AbortSignal.timeout === 'function'
            ? AbortSignal.timeout(CART_REQUEST_TIMEOUT_MS)
            : undefined,
      });
    } catch (error) {
      console.error('Logout error:', error);
      throw new Error(
        'Could not safely sign out. Please retry when connected.'
      );
    }
    if (!response.ok) {
      throw new Error(
        'Could not safely sign out. Please retry when connected.'
      );
    }
    endDeferredCartLogout?.(merchantSlug);
    clearCustomerAuthRollbackPending(merchantSlug);
    // Complete the deferred revocation cleanup now that logout committed.
    // A storage failure must not strand the committed logout: keep the
    // retirement fence for a later retry, but finish local sign-out.
    const erased = eraseRetiredCartCache(
      merchantSlug,
      previousUserId ?? userId
    );
    if (erased) {
      clearCartDeviceRevocationPending?.(merchantSlug);
      clearCartDeviceSessionActive?.(merchantSlug);
      // Clear cart on logout to prevent cart data leakage between
      // users. Only on confirmed erasure: clearing unconditionally
      // would delete unscoped fallback keys (possibly another
      // merchant's parked cart) even when scoped erasure failed.
      clearCartStorage(merchantSlug, previousUserId ?? userId);
    }
    // Only drop the remembered identity on confirmed erasure: it is
    // the only record of which user the parked cache belongs to, and
    // the retained revocation fence needs it for the retry cleanup.
    if (erased) setRememberedCustomerUserId(merchantSlug, null);
    setUser(null);
    setCustomer(null);
    publishCustomerIdentity(null, null, merchantSlug);
    setOtpState(null);
  } catch (error) {
    // The auth logout did not commit: abandon the deferred revocation
    // without erasing the parked cache. If revocation itself failed,
    // keep its fence; the deferred marker always ends.
    if (revokedOk) cancelDeferredCartLogout?.(merchantSlug);
    else endDeferredCartLogout?.(merchantSlug);
    throw error;
  } finally {
    retirement.release();
  }
}
