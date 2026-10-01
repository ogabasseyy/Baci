/**
 * useAuth Hook — Thin wrapper around the Zustand auth store
 *
 * All auth state and logic lives in stores/auth-store.ts.
 * This wrapper preserves the existing API so all 21+ call sites
 * continue to work without changes.
 */

import type { Session, User } from '@supabase/supabase-js';
import { useShallow } from 'zustand/react/shallow';
import type { PasswordSignUpResult } from '@/lib/auth/sign-up-with-password';
import type { VerifySignupOtpResult } from '@/lib/auth/verify-signup-otp';
import type { SignupFlow } from '@/services/signup-lifecycle-telemetry';
import { useAuthStore } from '@/stores/auth-store';

export interface UseAuthReturn {
  activeAuthProvider: 'password' | 'google' | 'apple' | null;
  isAuthenticating: boolean;
  user: User | null;
  session: Session | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  signIn: (
    email: string,
    password: string
  ) => Promise<{ cancelled?: boolean; error: string | null }>;
  signUp: (params: {
    email: string;
    password: string;
    firstName?: string;
    lastName?: string;
    fullName?: string;
    signupFlow?: SignupFlow;
  }) => Promise<PasswordSignUpResult>;
  signInWithApple: () => Promise<{ cancelled?: boolean; error: string | null }>;
  signInWithGoogle: () => Promise<{
    cancelled?: boolean;
    error: string | null;
  }>;
  verifySignupOtp: (
    email: string,
    token: string,
    attemptId?: string,
    flow?: SignupFlow
  ) => Promise<VerifySignupOtpResult>;
  signOut: (onBeforeSignOut?: () => Promise<void>) => Promise<void>;
}

export function useAuth(): UseAuthReturn {
  return useAuthStore(
    useShallow((state) => ({
      activeAuthProvider: state.activeAuthProvider,
      isAuthenticating: state.isAuthenticating,
      user: state.user,
      session: state.session,
      isLoading: state.isLoading,
      isAuthenticated: state.isAuthenticated,
      signIn: state.signIn,
      signUp: state.signUp,
      signInWithApple: state.signInWithApple,
      signInWithGoogle: state.signInWithGoogle,
      verifySignupOtp: state.verifySignupOtp,
      signOut: state.signOut,
    }))
  );
}
