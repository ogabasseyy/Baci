import { beginCartSessionRetirement } from '@/hooks/cart/cart-session-write-fence';
// Session commit/logout orchestration for the storefront customer auth provider.
//
// Extracted from `customer-auth-context.tsx` so the provider stays focused on
// React state while this module owns session commit, live-identity publish,
// and cart clear. Session loading lives in `customer-auth-session-loader.ts`.
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
import { postCustomerAuthLogout } from './customer-auth-mutation';
import { retirePreviousAccountCartAuthority } from './customer-auth-retirement';
import type { CustomerSession } from './customer-auth-session-loader';
import {
  invalidateCustomerSessionLifecycle,
  loadCustomerSession,
} from './customer-auth-session-loader';
import {
  clearCustomerAuthRollbackPending,
  getRememberedCustomerUserId,
  resetRememberedCustomerSessionsForTests,
  rollbackCustomerAuthSession,
  setRememberedCustomerUserId,
} from './customer-auth-storage';
import {
  invalidateCustomerIdentityObservers,
  publishCustomerIdentity,
} from './customer-live-identity';
import { writeCustomerSessionHint } from './customer-session-hint';

export { loadCustomerSession, resetRememberedCustomerSessionsForTests };

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
  invalidateCustomerSessionLifecycle(merchantSlug);
  invalidateCustomerIdentityObservers(merchantSlug);
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
      writeCustomerSessionHint(merchantSlug, '0');
      setUser(null);
      setCustomer(null);
      publishCustomerIdentity(null, null, merchantSlug);
      return false;
    }
  }
  clearCustomerAuthRollbackPending(merchantSlug);
  setRememberedCustomerUserId(merchantSlug, session.user.id);
  writeCustomerSessionHint(merchantSlug, '1');
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
  invalidateCustomerSessionLifecycle(merchantSlug);
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
      response = await postCustomerAuthLogout(merchantSlug);
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
    writeCustomerSessionHint(merchantSlug, '0');
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
