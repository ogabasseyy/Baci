/**
 * Account-only email/password signup for merchant and staff registration.
 * Merchant provisioning remains separate; handle_new_user() must stay a no-op.
 */

import { isAuthApiError, type Session, type User } from '@supabase/supabase-js';
import { isConnectivityError, isDnsResolutionError } from '@/lib/api-errors';
import { buildPasswordSignUpCredentials } from '@/lib/auth/build-password-sign-up-credentials';
import { checkPasswordBreach } from '@/lib/auth/check-password-breach';
import { createPasswordSignupLifecycle } from '@/lib/auth/password-signup-lifecycle';
import { supabase } from '@/lib/supabase';
import { trackAuthTelemetry } from '@/services/auth-telemetry';
import type { SignupFlow } from '@/services/signup-lifecycle-telemetry';
import { generateUUID } from '@/utils/uuid';

export interface PasswordSignUpResult {
  error: string | null;
  /** Email already has an account — caller should route to sign-in. */
  accountExists?: boolean;
  /** New account created but a session was not returned (email confirmation on). */
  needsEmailConfirmation?: boolean;
  /** A native session was committed to the global auth store. */
  sessionEstablished?: boolean;
  signupAttemptId?: string;
}

interface SignUpStateUpdate {
  activeAuthProvider?: 'password' | null;
  isAuthenticating?: boolean;
  session?: Session | null;
  user?: User | null;
  isAuthenticated?: boolean;
  isInitialized?: boolean;
  isLoading?: boolean;
}

interface RunPasswordSignUpOptions {
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  getCurrentUserId: () => string | undefined;
  onResetUserStores: () => Promise<void>;
  setState: (state: SignUpStateUpdate) => void;
  signupFlow: SignupFlow;
}

function isRateLimited(message: string, status: number | undefined): boolean {
  return (
    status === 429 || /rate limit|for security purposes|too many/i.test(message)
  );
}

function isAlreadyRegistered(message: string): boolean {
  return /already registered|already been registered|user already exists/i.test(
    message
  );
}

export async function runPasswordSignUp({
  email,
  password,
  firstName,
  lastName,
  fullName,
  getCurrentUserId,
  onResetUserStores,
  setState,
  signupFlow,
}: RunPasswordSignUpOptions): Promise<PasswordSignUpResult> {
  const startedAt = Date.now();
  const attemptId = generateUUID();
  let dnsRetryAttempted = false;
  const captureLifecycle = createPasswordSignupLifecycle({
    attemptId,
    flow: signupFlow,
    startedAt,
  });
  setState({ activeAuthProvider: 'password', isAuthenticating: true });
  trackAuthTelemetry({ provider: 'password', stage: 'start' });
  captureLifecycle('password_signup_started', 'started');

  try {
    const { count, isBreached } = await checkPasswordBreach(password);
    if (isBreached) {
      trackAuthTelemetry({
        code: 'password_breached',
        durationMs: Date.now() - startedAt,
        provider: 'password',
        stage: 'failure',
      });
      captureLifecycle('password_breached', 'failed', {
        failureClass: 'password_breached',
      });
      return {
        error: `This password has appeared in ${(count ?? 1).toLocaleString()} known data breaches. Please choose a different, more secure password.`,
      };
    }

    const signUpCredentials = buildPasswordSignUpCredentials({
      attemptId,
      email,
      firstName,
      fullName,
      lastName,
      password,
      signupFlow,
    });
    const trackDnsRetry = (error: unknown) => {
      dnsRetryAttempted = true;
      trackAuthTelemetry({
        code: 'password_signup_dns_retry',
        durationMs: Date.now() - startedAt,
        level: 'warn',
        metadata: { retryAttempted: true },
        provider: 'password',
        stage: 'failure',
      });
      captureLifecycle('password_signup_dns_retry', 'retrying', {
        error,
        failureClass: 'connectivity_dns',
        retryAttempted: true,
      });
    };

    let signUpResult: Awaited<ReturnType<typeof supabase.auth.signUp>>;
    try {
      signUpResult = await supabase.auth.signUp(signUpCredentials);
    } catch (firstSignUpError) {
      if (!isDnsResolutionError(firstSignUpError)) {
        throw firstSignUpError;
      }
      trackDnsRetry(firstSignUpError);
      signUpResult = await supabase.auth.signUp(signUpCredentials);
    }

    if (!dnsRetryAttempted && isDnsResolutionError(signUpResult.error)) {
      trackDnsRetry(signUpResult.error);
      signUpResult = await supabase.auth.signUp(signUpCredentials);
    }

    const { data, error } = signUpResult;

    if (error) {
      const status = isAuthApiError(error) ? error.status : undefined;
      if (isRateLimited(error.message, status)) {
        trackAuthTelemetry({
          code: 'password_signup_rate_limited',
          durationMs: Date.now() - startedAt,
          provider: 'password',
          stage: 'failure',
        });
        captureLifecycle('password_signup_rate_limited', 'failed', {
          error,
          failureClass: 'rate_limited',
        });
        return {
          error: 'Too many attempts. Please wait a minute and try again.',
        };
      }
      // Treat an existing account as a non-error so the caller can redirect to
      // sign-in without leaking whether the email is registered.
      if (isAlreadyRegistered(error.message)) {
        captureLifecycle('password_signup_account_exists', 'account_exists', {
          error,
        });
        return { error: null, accountExists: true };
      }
      if (isConnectivityError(error)) {
        const kind = isDnsResolutionError(error) ? 'dns' : 'transport';
        trackAuthTelemetry({
          code: 'password_signup_connectivity_error',
          durationMs: Date.now() - startedAt,
          metadata: { kind, retryAttempted: dnsRetryAttempted },
          provider: 'password',
          stage: 'failure',
        });
        captureLifecycle('password_signup_connectivity_error', 'failed', {
          error,
          failureClass:
            kind === 'dns' ? 'connectivity_dns' : 'connectivity_transport',
          retryAttempted: dnsRetryAttempted,
        });
        return {
          error: 'Unable to connect. Please check your internet connection.',
        };
      }
      trackAuthTelemetry({
        code: 'password_signup_error',
        durationMs: Date.now() - startedAt,
        provider: 'password',
        stage: 'failure',
      });
      captureLifecycle('password_signup_error', 'failed', {
        error,
        failureClass: 'auth_provider',
      });
      return { error: error.message };
    }

    // Anti-enumeration: when confirmation is enabled, signing up an existing
    // email returns a user with an empty identities array and no session.
    if (
      data.user &&
      Array.isArray(data.user.identities) &&
      data.user.identities.length === 0
    ) {
      captureLifecycle('password_signup_account_exists', 'account_exists');
      return { error: null, accountExists: true };
    }

    if (data.session && data.user) {
      const currentUserId = getCurrentUserId();
      if (currentUserId !== data.user.id) {
        await onResetUserStores();
      }
      setState({
        session: data.session,
        user: data.user,
        isAuthenticated: true,
        isInitialized: true,
        isLoading: false,
      });
      trackAuthTelemetry({
        durationMs: Date.now() - startedAt,
        metadata: {
          ...(dnsRetryAttempted ? { dnsRetryAttempted: true } : {}),
          hasSession: true,
        },
        provider: 'password',
        stage: 'success',
      });
      captureLifecycle('password_signup_succeeded', 'succeeded', {
        retryAttempted: dnsRetryAttempted,
      });
      return { error: null, sessionEstablished: true };
    }

    // New account created but no session — email confirmation is required.
    trackAuthTelemetry({
      durationMs: Date.now() - startedAt,
      metadata: {
        ...(dnsRetryAttempted ? { dnsRetryAttempted: true } : {}),
        hasSession: false,
      },
      provider: 'password',
      stage: 'success',
    });
    captureLifecycle(
      'password_signup_verification_required',
      'verification_required',
      {
        retryAttempted: dnsRetryAttempted,
      }
    );
    return {
      error: null,
      needsEmailConfirmation: true,
      signupAttemptId: attemptId,
    };
  } catch (caught) {
    const isConnectivityFailure = isConnectivityError(caught);
    const message = isConnectivityFailure
      ? 'Unable to connect. Please check your internet connection.'
      : caught instanceof Error
        ? caught.message
        : 'Sign-up failed. Please try again.';
    const kind = isDnsResolutionError(caught) ? 'dns' : 'transport';
    trackAuthTelemetry({
      code: isConnectivityFailure
        ? 'password_signup_connectivity_error'
        : 'password_signup_unknown_error',
      durationMs: Date.now() - startedAt,
      ...(isConnectivityFailure && {
        metadata: { kind, retryAttempted: dnsRetryAttempted },
      }),
      provider: 'password',
      stage: 'failure',
    });
    captureLifecycle(
      isConnectivityFailure
        ? 'password_signup_connectivity_error'
        : 'password_signup_unknown_error',
      'failed',
      {
        error: caught,
        failureClass: isConnectivityFailure
          ? kind === 'dns'
            ? 'connectivity_dns'
            : 'connectivity_transport'
          : 'unexpected',
        retryAttempted: dnsRetryAttempted,
      }
    );
    return { error: message };
  } finally {
    setState({ activeAuthProvider: null, isAuthenticating: false });
  }
}
