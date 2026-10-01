/**
 * Auth Store — Single source of truth for authentication state
 *
 * Replaces the per-component useAuth hook to avoid duplicate
 * onAuthStateChange subscriptions (one per call site).
 * Now there is exactly ONE listener, managed by initialize().
 */

import type { Session, User } from '@supabase/supabase-js';
import { create } from 'zustand';
import { isConnectivityError } from '@/lib/api-errors';
import {
  classifyAuthError,
  getAuthErrorCode,
} from '@/lib/auth/auth-error-classification';
import { removeAuthStorageKeys } from '@/lib/auth/auth-session-storage';
import { createAuthStateController } from '@/lib/auth/auth-state-controller';
import {
  type PasswordSignUpResult,
  runPasswordSignUp,
} from '@/lib/auth/sign-up-with-password';
import {
  runSocialSignIn,
  type SocialAuthProvider,
} from '@/lib/auth/social-auth-helper';
import {
  runSignupOtpVerification,
  type VerifySignupOtpResult,
} from '@/lib/auth/verify-signup-otp';
import { clearAdminQueryCache } from '@/lib/query-client';
import { supabase, supabaseAuthStorageKey } from '@/lib/supabase';
import { trackAuthTelemetry } from '@/services/auth-telemetry';
import type { SignupFlow } from '@/services/signup-lifecycle-telemetry';
import { useRevenueCatStore } from '@/stores/revenueCatStore';

type AuthProvider = 'password' | SocialAuthProvider;

interface AuthState {
  activeAuthProvider: AuthProvider | null;
  isAuthenticating: boolean;
  user: User | null;
  session: Session | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  /** True after the initial getUser() check has resolved */
  isInitialized: boolean;
}

interface AuthActions {
  initialize: () => () => void;
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

export type AuthStore = AuthState & AuthActions;

/**
 * Resets user-specific stores to prevent cross-user data bleed.
 * Called on SIGNED_IN events and during signOut.
 */
async function resetUserStores(): Promise<void> {
  clearAdminQueryCache();
  useRevenueCatStore.getState().cleanup();
  const { useSettingsStore } = await import('@/hooks/useSettingsStore');
  useSettingsStore.getState().reset();
}

export const useAuthStore = create<AuthStore>((set, get) => {
  const authStateController = createAuthStateController({
    auth: supabase.auth,
    getState: () => ({ user: get().user }),
    resetUserStores,
    setState: (state) => set(state),
  });

  return {
    activeAuthProvider: null,
    isAuthenticating: false,
    user: null,
    session: null,
    isLoading: true,
    isAuthenticated: false,
    isInitialized: false,

    initialize: () => authStateController.initialize(),

    signIn: async (email: string, password: string) => {
      const startedAt = Date.now();
      set({ activeAuthProvider: 'password', isAuthenticating: true });
      trackAuthTelemetry({
        provider: 'password',
        stage: 'start',
      });

      try {
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (error) {
          trackAuthTelemetry({
            code: 'password_invalid_credentials',
            durationMs: Date.now() - startedAt,
            metadata: {
              hasSession: Boolean(data.session),
            },
            provider: 'password',
            stage: 'failure',
          });
          return { error: error.message };
        }

        if (data.session && data.user) {
          const currentUserId = get().user?.id;
          set({
            session: data.session,
            user: data.user,
            isAuthenticated: true,
            isInitialized: true,
            isLoading: false,
          });

          if (currentUserId !== data.user.id) {
            void resetUserStores();
          }
        }

        trackAuthTelemetry({
          durationMs: Date.now() - startedAt,
          metadata: {
            hasSession: Boolean(data.session),
            hasUser: Boolean(data.user),
          },
          provider: 'password',
          stage: 'success',
        });

        return { error: null };
      } catch (error) {
        const message = isConnectivityError(error)
          ? 'Unable to connect. Please check your internet connection.'
          : error instanceof Error
            ? error.message
            : 'Password sign-in failed. Please try again.';

        trackAuthTelemetry({
          code: 'password_unknown_error',
          durationMs: Date.now() - startedAt,
          provider: 'password',
          stage: 'failure',
        });

        return { error: message };
      } finally {
        set({ activeAuthProvider: null, isAuthenticating: false });
      }
    },

    signUp: async (params) =>
      runPasswordSignUp({
        ...params,
        getCurrentUserId: () => get().user?.id,
        onResetUserStores: () => resetUserStores(),
        setState: (state) => set(state),
        signupFlow: params.signupFlow ?? 'merchant',
      }),

    signInWithGoogle: () => {
      return runSocialSignIn('google', {
        getCurrentUserId: () => get().user?.id,
        nativeSignIn: async () => {
          const { signInWithGoogleNative } = await import(
            '@/lib/auth/sign-in-with-google'
          );
          return signInWithGoogleNative();
        },
        onResetUserStores: () => resetUserStores(),
        setState: (state) => set(state),
      });
    },

    signInWithApple: () => {
      return runSocialSignIn('apple', {
        getCurrentUserId: () => get().user?.id,
        nativeSignIn: async () => {
          const { signInWithAppleNative } = await import(
            '@/lib/auth/sign-in-with-apple'
          );
          return signInWithAppleNative();
        },
        onResetUserStores: () => resetUserStores(),
        setState: (state) => set(state),
      });
    },

    verifySignupOtp: (
      email: string,
      token: string,
      attemptId?: string,
      flow?: SignupFlow
    ) =>
      runSignupOtpVerification({
        attemptId,
        email,
        flow,
        token,
        getCurrentUserId: () => get().user?.id,
        onResetUserStores: () => resetUserStores(),
        setState: (state) => set(state),
      }),

    signOut: async (onBeforeSignOut?: () => Promise<void>) => {
      if (onBeforeSignOut) {
        try {
          await onBeforeSignOut();
        } catch (error) {
          console.error('[AuthStore] onBeforeSignOut callback failed:', error);
        }
      }

      try {
        await resetUserStores();
      } catch (error) {
        console.warn(
          '[AuthStore] resetUserStores failed during sign-out',
          error
        );
      }

      let signOutError: unknown = null;
      try {
        const { error } = await supabase.auth.signOut({ scope: 'local' });
        signOutError = error;
      } catch (error) {
        signOutError = error;
      } finally {
        await authStateController.clearLocalAuthState({ resetStores: false });
      }

      if (!signOutError) {
        return;
      }

      const signOutErrorCode = getAuthErrorCode(signOutError);
      if (classifyAuthError(signOutError) === 'terminal') {
        return;
      }

      console.warn('[AuthStore] Local sign out returned an error', {
        code: signOutErrorCode,
      });

      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (session && supabaseAuthStorageKey) {
          removeAuthStorageKeys(supabaseAuthStorageKey);
        }
      } catch {
        // Local auth state is already cleared. Storage fallback is best effort.
      }
    },
  };
});
