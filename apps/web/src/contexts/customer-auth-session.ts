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
import {
  clearCartDeviceRevocationPending,
  markCartDeviceRevocationPending,
  revokeCartDeviceSession,
} from '@/hooks/cart/shared-cart-session-revoke-client';
import { bumpCartSessionGeneration } from '@/hooks/cart/shared-cart-storage';
import { clearCartStorage } from '@/hooks/use-cart';
import type { Customer, CustomerUser, OtpState } from './customer-auth-context';
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

async function retirePreviousAccountCartAuthority(
  merchantSlug: string,
  previousUserId: string
): Promise<boolean> {
  const retirement = beginCartSessionRetirement(merchantSlug);
  markCartDeviceRevocationPending?.(merchantSlug);
  bumpCartSessionGeneration();
  try {
    await retirement.drained;
    const revoked = await revokeCartDeviceSession(merchantSlug);
    if (!revoked.ok) {
      setRememberedCustomerUserId(merchantSlug, previousUserId);
      return false;
    }
    clearCartStorage(merchantSlug, previousUserId);
    clearCartDeviceRevocationPending?.(merchantSlug);
    setRememberedCustomerUserId(merchantSlug, null);
    return true;
  } catch {
    setRememberedCustomerUserId(merchantSlug, previousUserId);
    return false;
  } finally {
    retirement.release();
  }
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
  bumpCartSessionGeneration();
  try {
    const revoked = await retirement.drained
      .then(() => revokeCartDeviceSession(merchantSlug))
      .catch(() => ({ ok: false }));
    if (!revoked.ok)
      throw new Error(
        'Could not safely sign out. Please retry when connected.'
      );
    try {
      const response = await fetch('/api/storefront/auth/logout', {
        method: 'POST',
      });
      if (response.ok) {
        clearCustomerAuthRollbackPending(merchantSlug);
      }
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      setRememberedCustomerUserId(merchantSlug, null);
      setUser(null);
      setCustomer(null);
      publishCustomerIdentity(null, null, merchantSlug);
      setOtpState(null);
      // Clear cart on logout to prevent cart data leakage between users
      clearCartStorage(merchantSlug, previousUserId ?? userId);
    }
  } finally {
    retirement.release();
  }
}
