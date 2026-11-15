import { reconcileOrphanedDeferredCartLogout } from '@/hooks/cart/cart-deferred-logout';
import type { Customer, CustomerUser } from './customer-auth-context';
import { retirePreviousAccountCartAuthority } from './customer-auth-retirement';
import {
  getRememberedCustomerUserId,
  isCustomerAuthRollbackPending,
  rollbackCustomerAuthSession,
  setRememberedCustomerUserId,
} from './customer-auth-storage';
import {
  invalidateCustomerIdentityObservers,
  publishCustomerIdentity,
} from './customer-live-identity';
import {
  readCustomerSessionHint,
  writeCustomerSessionHint,
} from './customer-session-hint';

export interface CustomerSession {
  customer: Customer;
  user: CustomerUser;
}

type CustomerSessionFetchResult =
  | { status: 'authenticated'; session: CustomerSession }
  | { status: 'unauthenticated' }
  | { status: 'lookup_failed'; userId: string | null; httpStatus?: number };

async function fetchCustomerSession(
  merchantSlug: string
): Promise<CustomerSessionFetchResult> {
  const response = await fetch(
    `/api/storefront/auth/session?merchantSlug=${encodeURIComponent(merchantSlug)}`
  );
  if (response.ok === false) {
    return {
      status: 'lookup_failed',
      userId: null,
      httpStatus: response.status,
    };
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

export interface SessionSetters {
  currentUserId?: string | null;
  setUser: (user: CustomerUser | null) => void;
  setCustomer: (customer: Customer | null) => void;
  setIsLoading: (loading: boolean) => void;
}

/**
 * Module-scope session loader so try/catch/finally stays outside React components.
 */
export async function loadCustomerSession(
  merchantSlug: string,
  { currentUserId, setUser, setCustomer, setIsLoading }: SessionSetters,
  isCancelled: () => boolean = () => false,
  options: { bypassSessionHint?: boolean } = {}
): Promise<void> {
  invalidateCustomerIdentityObservers(merchantSlug);
  const previousUserId = getRememberedCustomerUserId(
    merchantSlug,
    currentUserId
  );
  reconcileOrphanedDeferredCartLogout(merchantSlug);
  try {
    if (isCustomerAuthRollbackPending(merchantSlug)) {
      if (previousUserId) {
        await retirePreviousAccountCartAuthority(merchantSlug, previousUserId);
        if (isCancelled()) return;
      }
      await rollbackCustomerAuthSession(merchantSlug);
      if (isCancelled()) return;
      writeCustomerSessionHint(merchantSlug, '0');
      setUser(null);
      setCustomer(null);
      publishCustomerIdentity(null, null, merchantSlug);
      return;
    }

    if (
      !options.bypassSessionHint &&
      !previousUserId &&
      readCustomerSessionHint() === '0'
    ) {
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
          await rollbackCustomerAuthSession(merchantSlug);
          if (isCancelled()) return;
          writeCustomerSessionHint(merchantSlug, '0');
          setUser(null);
          setCustomer(null);
          publishCustomerIdentity(null, null, merchantSlug);
          return;
        }
      }
      setRememberedCustomerUserId(merchantSlug, session.user.id);
      writeCustomerSessionHint(merchantSlug, '1');
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
      if (result.status === 'unauthenticated' || result.httpStatus === 401) {
        writeCustomerSessionHint(merchantSlug, '0');
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
