import type { Session, User } from '@supabase/supabase-js';
import { isConnectivityError } from '@/lib/api-errors';
import { supabase } from '@/lib/supabase';
import { signupAttemptIdSchema } from '@/schemas/signup-attempt-id';
import {
  captureMobileSignupLifecycle,
  type SignupFailureClass,
  type SignupFlow,
} from '@/services/signup-lifecycle-telemetry';

export interface VerifySignupOtpResult {
  error: string | null;
  sessionEstablished?: true;
}

interface VerificationStateUpdate {
  isAuthenticated: boolean;
  isInitialized: boolean;
  isLoading: boolean;
  session: Session;
  user: User;
}

interface RunSignupOtpVerificationOptions {
  attemptId?: string;
  email: string;
  flow?: SignupFlow;
  getCurrentUserId: () => string | undefined;
  onResetUserStores: () => Promise<void>;
  setState: (state: VerificationStateUpdate) => void;
  token: string;
}

function verificationErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/expired|invalid|token.*not found|otp/i.test(message)) {
    return 'That verification code is invalid or expired. Request a new code and try again.';
  }
  if (isConnectivityError(error)) {
    return 'Unable to connect. Check your internet connection and try again.';
  }
  return 'Email verification failed. Request a new code and try again.';
}

function verificationFailureClass(error: unknown): SignupFailureClass {
  const message = error instanceof Error ? error.message : String(error);
  if (/expired|invalid|token.*not found|otp/i.test(message)) {
    return 'invalid_verification';
  }
  return isConnectivityError(error)
    ? 'connectivity_transport'
    : 'auth_provider';
}

function getSignupContext(
  user: User,
  fallbackAttemptId: string | null,
  fallbackFlow: SignupFlow
): {
  attemptId: string | null;
  flow: SignupFlow;
} {
  const metadata = user.user_metadata;
  const parsedAttemptId = signupAttemptIdSchema.safeParse(
    metadata?.signup_attempt_id
  );
  const flow = metadata?.signup_flow;
  return {
    attemptId: parsedAttemptId.success
      ? parsedAttemptId.data
      : fallbackAttemptId,
    flow: flow === 'staff' || flow === 'merchant' ? flow : fallbackFlow,
  };
}

export async function runSignupOtpVerification({
  attemptId,
  email,
  flow = 'merchant',
  getCurrentUserId,
  onResetUserStores,
  setState,
  token,
}: RunSignupOtpVerificationOptions): Promise<VerifySignupOtpResult> {
  const startedAt = Date.now();
  const parsedAttemptId = signupAttemptIdSchema.safeParse(attemptId);
  const verificationContext = {
    attemptId: parsedAttemptId.success ? parsedAttemptId.data : null,
    flow,
  };
  void captureMobileSignupLifecycle({
    ...verificationContext,
    eventCode: 'signup_verification_started',
    outcome: 'started',
    stage: 'verification',
  });

  try {
    const { data, error } = await supabase.auth.verifyOtp({
      email,
      token,
      type: 'signup',
    });

    if (error) {
      void captureMobileSignupLifecycle({
        ...verificationContext,
        durationMs: Date.now() - startedAt,
        error,
        eventCode: 'signup_verification_failed',
        failureClass: verificationFailureClass(error),
        outcome: 'failed',
        stage: 'verification',
      });
      return { error: verificationErrorMessage(error) };
    }
    if (!data.session || !data.user) {
      void captureMobileSignupLifecycle({
        ...verificationContext,
        durationMs: Date.now() - startedAt,
        eventCode: 'signup_verification_incomplete',
        failureClass: 'incomplete_response',
        outcome: 'failed',
        stage: 'verification',
      });
      return {
        error:
          'Email verification did not finish. Request a new code and try again.',
      };
    }

    if (getCurrentUserId() !== data.user.id) {
      await onResetUserStores();
    }
    setState({
      isAuthenticated: true,
      isInitialized: true,
      isLoading: false,
      session: data.session,
      user: data.user,
    });

    const context = getSignupContext(
      data.user,
      verificationContext.attemptId,
      verificationContext.flow
    );
    void captureMobileSignupLifecycle({
      ...context,
      durationMs: Date.now() - startedAt,
      eventCode: 'signup_verification_succeeded',
      outcome: 'succeeded',
      stage: 'verification',
    });

    return { error: null, sessionEstablished: true };
  } catch (error) {
    void captureMobileSignupLifecycle({
      ...verificationContext,
      durationMs: Date.now() - startedAt,
      error,
      eventCode: 'signup_verification_failed',
      failureClass: isConnectivityError(error)
        ? 'connectivity_transport'
        : 'unexpected',
      outcome: 'failed',
      stage: 'verification',
    });
    return { error: verificationErrorMessage(error) };
  }
}
