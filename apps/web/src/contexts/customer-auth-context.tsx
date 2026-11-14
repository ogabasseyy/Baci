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
  signInWithApple as startAppleSignIn,
  signInWithGoogle as startGoogleSignIn,
} from './customer-auth-oauth';
import {
  commitCustomerAuthSession,
  loadCustomerSession,
  performCustomerLogout,
} from './customer-auth-session';
import { publishCustomerIdentity } from './customer-live-identity';
import { sendCustomerOtpRequest } from './customer-otp-send';
import { requestCustomerOtpVerification } from './customer-otp-verification';

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
  sentAt?: number;
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
  signInWithGoogle: (
    returnTo?: string
  ) => Promise<{ success: boolean; error?: string }>;
  signInWithApple: (
    returnTo?: string
  ) => Promise<{ success: boolean; error?: string }>;
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
    loadCustomerSession(merchantSlug, {
      currentUserId: user?.id,
      setUser,
      setCustomer,
      setIsLoading,
    });

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
      const result = await sendCustomerOtpRequest(email, merchantSlug);
      if (!result.success) return result;

      setOtpState({
        email,
        codeSent: true,
        expiresAt: result.expiresAt,
        sentAt: Date.now(),
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
      const response = await requestCustomerOtpVerification(
        merchantSlug,
        otpState.email,
        code
      );

      const data = await response.json();

      if (!response.ok) {
        return { success: false, error: data.error || 'Verification failed' };
      }

      // Set user and customer from response, retiring any previous
      // customer's device cart authority before switching identities.
      const committed = await commitCustomerAuthSession(
        merchantSlug,
        { customer: data.customer, user: data.user },
        {
          currentUserId: user?.id,
          setCustomer,
          setOtpState,
          setUser,
        }
      );
      if (!committed) {
        return {
          success: false,
          error:
            'Could not safely switch accounts. Please retry when connected.',
        };
      }

      return { success: true };
    } catch (error) {
      console.error('Verify OTP error:', error);
      return { success: false, error: 'Network error. Please try again.' };
    }
  };

  // Logout
  const logout = () =>
    performCustomerLogout(
      merchantSlug,
      setUser,
      setCustomer,
      setOtpState,
      user?.id
    );

  const signInWithGoogle = (returnTo?: string) =>
    startGoogleSignIn(merchantSlug, returnTo);
  const signInWithApple = (returnTo?: string) =>
    startAppleSignIn(merchantSlug, returnTo);

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
