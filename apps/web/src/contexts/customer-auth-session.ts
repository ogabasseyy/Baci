// Session load/logout orchestration for the storefront customer auth provider.
//
// Extracted from `customer-auth-context.tsx` so the provider stays focused on
// React state while this module owns the session fetch, the setter fan-out,
// the live-identity publish, and the cart clear. The try/catch/finally control
// flow stays at module scope so the provider remains React-Compiler friendly.
//
// The type imports below are type-only (erased at compile time); there is no
// runtime cycle back into the context module.
import { revokeCartDeviceSession } from '@/hooks/cart/shared-cart-session-revoke-client';
import { clearCartStorage } from '@/hooks/use-cart';
import type { Customer, CustomerUser, OtpState } from './customer-auth-context';
import {
  getLiveCustomerIdentity,
  publishCustomerIdentity,
} from './customer-live-identity';

interface CustomerSession {
  customer: Customer;
  user: CustomerUser;
}

const CUSTOMER_AUTH_USER_KEY_PREFIX = 'baci-customer-auth-user';
const rememberedCustomerUserByMerchant = new Map<string, string>();

function getCustomerAuthUserStorageKey(merchantSlug: string): string {
  return `${CUSTOMER_AUTH_USER_KEY_PREFIX}-${merchantSlug}`;
}

function getRememberedCustomerUserId(
  merchantSlug: string,
  currentUserId?: string | null
): string | null {
  if (currentUserId) return currentUserId;
  const live = getLiveCustomerIdentity();
  if (live.merchantSlug === merchantSlug && live.userId) return live.userId;
  const inMemory = rememberedCustomerUserByMerchant.get(merchantSlug);
  if (inMemory) return inMemory;
  if (typeof window === 'undefined') return null;
  try {
    return (
      window.localStorage.getItem(
        getCustomerAuthUserStorageKey(merchantSlug)
      ) || null
    );
  } catch {
    return null;
  }
}

function setRememberedCustomerUserId(
  merchantSlug: string,
  userId: string | null
): void {
  if (userId) {
    rememberedCustomerUserByMerchant.set(merchantSlug, userId);
  } else {
    rememberedCustomerUserByMerchant.delete(merchantSlug);
  }
  if (typeof window === 'undefined') return;
  try {
    const key = getCustomerAuthUserStorageKey(merchantSlug);
    if (userId) {
      window.localStorage.setItem(key, userId);
    } else {
      window.localStorage.removeItem(key);
    }
  } catch {
    // Ignore storage access errors in private browsing or restricted frames.
  }
}

export function resetRememberedCustomerSessionsForTests(): void {
  rememberedCustomerUserByMerchant.clear();
  if (typeof window === 'undefined') return;
  try {
    for (const key of Object.keys(window.localStorage)) {
      if (key.startsWith(`${CUSTOMER_AUTH_USER_KEY_PREFIX}-`)) {
        window.localStorage.removeItem(key);
      }
    }
  } catch {
    // Ignore storage access errors in test cleanup.
  }
}

async function retirePreviousAccountCartAuthority(
  merchantSlug: string,
  previousUserId: string
): Promise<boolean> {
  const revoked = await revokeCartDeviceSession(merchantSlug);
  clearCartStorage(merchantSlug, previousUserId);
  if (revoked.ok) {
    setRememberedCustomerUserId(merchantSlug, null);
  }
  return revoked.ok;
}

async function fetchCustomerSession(
  merchantSlug: string
): Promise<CustomerSession | null> {
  const response = await fetch(
    `/api/storefront/auth/session?merchantSlug=${encodeURIComponent(merchantSlug)}`
  );
  const data = (await response.json()) as {
    authenticated?: boolean;
    customer?: Customer;
    user?: CustomerUser;
  };

  if (!data.authenticated || !data.user || !data.customer) {
    return null;
  }

  return {
    customer: data.customer,
    user: data.user,
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
    const session = await fetchCustomerSession(merchantSlug);
    if (isCancelled()) return;

    if (session) {
      if (previousUserId && previousUserId !== session.user.id) {
        await retirePreviousAccountCartAuthority(merchantSlug, previousUserId);
        if (isCancelled()) return;
      }
      setRememberedCustomerUserId(merchantSlug, session.user.id);
      setUser(session.user);
      setCustomer(session.customer);
      publishCustomerIdentity(session.user, session.customer, merchantSlug);
    } else {
      if (previousUserId) {
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
): Promise<void> {
  const previousUserId = getRememberedCustomerUserId(
    merchantSlug,
    currentUserId
  );
  if (previousUserId && previousUserId !== session.user.id) {
    await retirePreviousAccountCartAuthority(merchantSlug, previousUserId);
  }
  setRememberedCustomerUserId(merchantSlug, session.user.id);
  setUser(session.user);
  setCustomer(session.customer);
  publishCustomerIdentity(session.user, session.customer, merchantSlug);
  setOtpState(null);
}

export async function prepareCustomerOAuthRedirect(
  merchantSlug: string,
  currentUserId?: string | null
): Promise<boolean> {
  const previousUserId = getRememberedCustomerUserId(
    merchantSlug,
    currentUserId
  );
  if (!previousUserId) return true;
  return await retirePreviousAccountCartAuthority(merchantSlug, previousUserId);
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
  // Do not clear Auth or report success until this device's cart
  // authority is retired.
  const revoked = await revokeCartDeviceSession(merchantSlug);
  if (!revoked.ok)
    throw new Error('Could not safely sign out. Please retry when connected.');
  try {
    await fetch('/api/storefront/auth/logout', { method: 'POST' });
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
}
