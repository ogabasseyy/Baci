'use client';

import {
  createContext,
  type ReactNode,
  use,
  useEffect,
  useLayoutEffect,
  useState,
} from 'react';
import { useCustomerProfileUpdate } from '@/hooks/use-customer-profile-update';
import {
  loadCustomerSession,
  performCustomerLogout,
} from './customer-auth-session';
import { publishCustomerIdentity } from './customer-live-identity';

export interface CustomerUser {
  id: string;
  email: string;
  role: string;
}

export interface Customer {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone?: string;
  address?: string;
  /** ISO `YYYY-MM-DD`. Powers the quiz 18+ age gate; null until captured. */
  date_of_birth?: string | null;
  saved_addresses?: SavedAddress[];
  store_credit?: number;
  total_orders?: number;
  total_spent?: number;
  created_at?: string;
}

export interface SavedAddress {
  id: string;
  label: string;
  full_name: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  country: string;
  postal_code?: string;
  is_default?: boolean;
}

export interface OtpState {
  email: string;
  codeSent: boolean;
  expiresAt?: number;
}

interface OAuthRedirectResponse {
  url?: string;
  error?: string;
}

interface CustomerAuthContextType {
  user: CustomerUser | null;
  customer: Customer | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  otpState: OtpState | null;
  // Auth actions
  sendOtp: (email: string) => Promise<{ success: boolean; error?: string }>;
  verifyOtp: (code: string) => Promise<{ success: boolean; error?: string }>;
  signInWithGoogle: () => Promise<{ success: boolean; error?: string }>;
  signInWithApple: () => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  // Customer data actions
  refreshCustomer: () => Promise<void>;
  updateCustomer: (
    data: Partial<Customer>
  ) => Promise<{ success: boolean; error?: string }>;
}

const CustomerAuthContext = createContext<CustomerAuthContextType | null>(null);

interface CustomerAuthProviderProps {
  children: ReactNode;
  merchantSlug: string;
}

export function CustomerAuthProvider({
  children,
  merchantSlug,
}: CustomerAuthProviderProps) {
  const [user, setUser] = useState<CustomerUser | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [otpState, setOtpState] = useState<OtpState | null>(null);

  const isAuthenticated = !!user && !!customer;

  // Reset the auth state during render when the storefront (merchantSlug prop)
  // changes, via a prev-prop comparison instead of inside the effect. Routing
  // these resets through the effect forces an extra render where the previous
  // store's customer is briefly visible. Initial state already matches a fresh
  // load (loading + signed out), so only a runtime prop change adjusts here.
  // See react.dev "Adjusting some state when a prop changes".
  const [prevMerchantSlug, setPrevMerchantSlug] = useState(merchantSlug);
  if (merchantSlug !== prevMerchantSlug) {
    // Render-phase state reset ONLY (react.dev "Adjusting some state
    // when a prop changes"): React discards these setStates if it
    // abandons the render. The live-identity publish MUST NOT live
    // here — the module mutation cannot roll back, so a speculative
    // render would report a merchant switch that never committed and
    // discard a healthy in-flight checkout (Codex R129 P2). It runs
    // in the committed layout effect below instead.
    setPrevMerchantSlug(merchantSlug);
    setIsLoading(true);
    setUser(null);
    setCustomer(null);
    setOtpState(null);
  }

  // Check session on demand (e.g. refreshCustomer).
  const checkSession = () =>
    loadCustomerSession(merchantSlug, { setUser, setCustomer, setIsLoading });

  // Publish the storefront reset commit-synchronously (Codex R129
  // P2, R133 P2): a layout effect leaves no post-commit window in
  // which a settling promise continuation could read the previous
  // storefront's identity and publish the old store's result into
  // the newly committed view. Runs on mount and every committed
  // merchantSlug change. The async session load stays in the
  // passive effect below.
  useLayoutEffect(() => {
    publishCustomerIdentity(null, null, merchantSlug);
  }, [merchantSlug]);

  useEffect(() => {
    let cancelled = false;

    void loadCustomerSession(
      merchantSlug,
      { setUser, setCustomer, setIsLoading },
      () => cancelled
    );

    return () => {
      cancelled = true;
    };
  }, [merchantSlug]);

  // Send OTP code
  const sendOtp = async (
    email: string
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      const response = await fetch('/api/storefront/auth/send-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, merchantSlug }),
      });

      const data = await response.json();

      if (!response.ok) {
        return { success: false, error: data.error || 'Failed to send code' };
      }

      // Set OTP state with 10 minute expiry
      setOtpState({
        email,
        codeSent: true,
        expiresAt: Date.now() + 10 * 60 * 1000,
      });

      return { success: true };
    } catch (error) {
      console.error('Send OTP error:', error);
      return { success: false, error: 'Network error. Please try again.' };
    }
  };

  // Verify OTP code
  const verifyOtp = async (
    code: string
  ): Promise<{ success: boolean; error?: string }> => {
    if (!otpState?.email) {
      return { success: false, error: 'Please enter your email first' };
    }

    try {
      const response = await fetch('/api/storefront/auth/verify-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: otpState.email,
          token: code,
          merchantSlug,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        return { success: false, error: data.error || 'Verification failed' };
      }

      // Set user and customer from response
      setUser(data.user);
      setCustomer(data.customer);
      publishCustomerIdentity(data.user, data.customer, merchantSlug);
      setOtpState(null);

      return { success: true };
    } catch (error) {
      console.error('Verify OTP error:', error);
      return { success: false, error: 'Network error. Please try again.' };
    }
  };

  // Logout
  const logout = () =>
    performCustomerLogout(merchantSlug, setUser, setCustomer, setOtpState);

  // Shared OAuth sign-in helper
  const signInWithOAuth = async (
    endpointPath: string,
    allowedHosts: string[],
    providerLabel: string
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      // Use the current browser origin to support custom domains (e.g., ogabassey.com)
      // This automatically handles: localhost, subdomains (*.usebaci.com), and custom domains
      // We redirect to /account/callback which exchanges the OAuth code for a session
      let redirectPath = '/account/callback';
      if (typeof window !== 'undefined') {
        const pathname = window.location.pathname;
        // If we are using path-based routing (e.g. /ogabassey/...), preserve the slug
        if (pathname.startsWith(`/${merchantSlug}`)) {
          redirectPath = `/${merchantSlug}/account/callback`;
        }
      }

      const redirectUrl =
        typeof window !== 'undefined'
          ? `${window.location.origin}${redirectPath}`
          : '/account/callback';

      const response = await fetch(endpointPath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ merchantSlug, redirectUrl }),
      });

      const data: OAuthRedirectResponse = await response.json();

      if (!response.ok) {
        return {
          success: false,
          error: data.error || `Failed to initiate ${providerLabel} sign-in`,
        };
      }

      // Check for data.url before redirecting
      if (!data.url) {
        return {
          success: false,
          error: 'Missing OAuth redirect URL',
        };
      }

      // Validate that the URL is from an allowed OAuth provider
      try {
        const url = new URL(data.url);
        const isValidDomain = allowedHosts.some((h) => {
          if (h.startsWith('.')) {
            // Wildcard domain like .google.com or .supabase.co
            return url.hostname.endsWith(h);
          }
          return url.hostname === h;
        });

        if (!isValidDomain) {
          return {
            success: false,
            error: 'Invalid OAuth provider URL',
          };
        }
      } catch {
        return {
          success: false,
          error: 'Invalid OAuth URL format',
        };
      }

      window.location.href = data.url;
      return { success: true };
    } catch (error) {
      console.error(providerLabel, 'sign-in error:', error);
      return { success: false, error: 'Network error. Please try again.' };
    }
  };

  // Sign in with Google OAuth
  const signInWithGoogle = (): Promise<{
    success: boolean;
    error?: string;
  }> => {
    return signInWithOAuth(
      '/api/storefront/auth/google',
      [
        'accounts.google.com',
        'www.google.com',
        '.google.com', // Wildcard for *.google.com
        'supabase.co',
        '.supabase.co', // Wildcard for *.supabase.co
        ...(process.env.NODE_ENV !== 'production'
          ? ['127.0.0.1', 'localhost']
          : []),
      ],
      'Google'
    );
  };

  // Sign in with Apple OAuth
  const signInWithApple = (): Promise<{
    success: boolean;
    error?: string;
  }> => {
    return signInWithOAuth(
      '/api/storefront/auth/apple',
      [
        'appleid.apple.com',
        '.apple.com', // Wildcard for *.apple.com
        'supabase.co',
        '.supabase.co', // Wildcard for *.supabase.co
        ...(process.env.NODE_ENV !== 'production'
          ? ['127.0.0.1', 'localhost']
          : []),
      ],
      'Apple'
    );
  };

  // Refresh customer data
  const refreshCustomer = async () => {
    if (!user) return;
    await checkSession();
  };

  // Update customer data. The write-orchestration (identity snapshot, server
  // expected_user_id gate, guarded local merge) lives in a focused hook.
  const updateCustomer = useCustomerProfileUpdate({
    customer,
    merchantSlug,
    setCustomer,
    user,
  });

  return (
    <CustomerAuthContext.Provider
      value={{
        user,
        customer,
        isAuthenticated,
        isLoading,
        otpState,
        sendOtp,
        verifyOtp,
        signInWithGoogle,
        signInWithApple,
        logout,
        refreshCustomer,
        updateCustomer,
      }}
    >
      {children}
    </CustomerAuthContext.Provider>
  );
}

export function useCustomerAuth() {
  const context = use(CustomerAuthContext);
  if (!context) {
    throw new Error(
      'useCustomerAuth must be used within a CustomerAuthProvider'
    );
  }
  return context;
}

/**
 * Returns the customer auth context without throwing outside the provider.
 * Use this for storefront components that can render both inside checkout/auth
 * flows and in public shells where no customer session provider is mounted.
 * Components that require customer auth should keep using useCustomerAuth().
 */
export function useOptionalCustomerAuth(): CustomerAuthContextType | null {
  return use(CustomerAuthContext);
}
