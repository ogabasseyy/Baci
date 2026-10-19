// Session load/logout orchestration for the storefront customer auth provider.
//
// Extracted from `customer-auth-context.tsx` so the provider stays focused on
// React state while this module owns the session fetch, the setter fan-out,
// the live-identity publish, and the cart clear. The try/catch/finally control
// flow stays at module scope so the provider remains React-Compiler friendly.
//
// The type imports below are type-only (erased at compile time); there is no
// runtime cycle back into the context module.
import { clearCartStorage } from '@/hooks/use-cart';
import type { Customer, CustomerUser, OtpState } from './customer-auth-context';
import { publishCustomerIdentity } from './customer-live-identity';

interface CustomerSession {
  customer: Customer;
  user: CustomerUser;
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
  setUser: (user: CustomerUser | null) => void;
  setCustomer: (customer: Customer | null) => void;
  setIsLoading: (loading: boolean) => void;
}

// Module-scope helper so the try/catch/finally control flow lives outside the
// component body, keeping the provider compilable by the React Compiler.
export async function loadCustomerSession(
  merchantSlug: string,
  { setUser, setCustomer, setIsLoading }: SessionSetters,
  isCancelled: () => boolean = () => false
): Promise<void> {
  try {
    const session = await fetchCustomerSession(merchantSlug);
    if (isCancelled()) return;

    if (session) {
      setUser(session.user);
      setCustomer(session.customer);
      publishCustomerIdentity(session.user, session.customer, merchantSlug);
    } else {
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

// Module-scope helper for logout so its try/catch/finally stays outside render.
export async function performCustomerLogout(
  merchantSlug: string,
  setUser: (user: CustomerUser | null) => void,
  setCustomer: (customer: Customer | null) => void,
  setOtpState: (otp: OtpState | null) => void
): Promise<void> {
  try {
    await fetch('/api/storefront/auth/logout', { method: 'POST' });
  } catch (error) {
    console.error('Logout error:', error);
  } finally {
    setUser(null);
    setCustomer(null);
    publishCustomerIdentity(null, null, merchantSlug);
    setOtpState(null);
    // Clear cart on logout to prevent cart data leakage between users
    clearCartStorage(merchantSlug);
  }
}
