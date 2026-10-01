import type { Session, User } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  captureMobileSignupLifecycle: vi.fn().mockResolvedValue(undefined),
  verifyOtp: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      verifyOtp: mocks.verifyOtp,
    },
  },
}));

vi.mock('@/services/signup-lifecycle-telemetry', () => ({
  captureMobileSignupLifecycle: mocks.captureMobileSignupLifecycle,
}));

import { runSignupOtpVerification } from './verify-signup-otp';

function createSession(userId = 'verified-user'): Session {
  const user: User = {
    app_metadata: {},
    aud: 'authenticated',
    created_at: '2026-07-28T00:00:00.000Z',
    id: userId,
    user_metadata: {
      signup_attempt_id: '123e4567-e89b-42d3-a456-426614174000',
      signup_flow: 'merchant',
    },
  };

  return {
    access_token: `access-${userId}`,
    expires_in: 3600,
    refresh_token: `refresh-${userId}`,
    token_type: 'bearer',
    user,
  };
}

describe('runSignupOtpVerification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses signup OTP only, awaits cross-user reset, then commits the exact session', async () => {
    const session = createSession();
    const reset = Promise.withResolvers<void>();
    const setState = vi.fn();
    mocks.verifyOtp.mockResolvedValue({
      data: { session, user: session.user },
      error: null,
    });

    const verification = runSignupOtpVerification({
      email: 'merchant@example.com',
      getCurrentUserId: () => 'prior-user',
      onResetUserStores: () => reset.promise,
      setState,
      token: '123456',
    });

    await vi.waitFor(() => {
      expect(mocks.verifyOtp).toHaveBeenCalledWith({
        email: 'merchant@example.com',
        token: '123456',
        type: 'signup',
      });
    });
    expect(setState).not.toHaveBeenCalled();

    reset.resolve();

    await expect(verification).resolves.toEqual({
      error: null,
      sessionEstablished: true,
    });
    expect(setState).toHaveBeenCalledWith({
      isAuthenticated: true,
      isInitialized: true,
      isLoading: false,
      session,
      user: session.user,
    });
    expect(mocks.verifyOtp).toHaveBeenCalledOnce();
    expect(mocks.captureMobileSignupLifecycle).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptId: '123e4567-e89b-42d3-a456-426614174000',
        eventCode: 'signup_verification_succeeded',
        flow: 'merchant',
        outcome: 'succeeded',
        stage: 'verification',
      })
    );
  });

  it('does not authenticate when Supabase omits the session or user', async () => {
    const setState = vi.fn();
    mocks.verifyOtp.mockResolvedValue({
      data: { session: null, user: createSession().user },
      error: null,
    });

    await expect(
      runSignupOtpVerification({
        attemptId: '123e4567-e89b-42d3-a456-426614174000',
        email: 'merchant@example.com',
        getCurrentUserId: () => undefined,
        onResetUserStores: vi.fn(),
        setState,
        token: '123456',
      })
    ).resolves.toEqual({
      error:
        'Email verification did not finish. Request a new code and try again.',
    });
    expect(setState).not.toHaveBeenCalled();
    expect(mocks.captureMobileSignupLifecycle).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptId: '123e4567-e89b-42d3-a456-426614174000',
        eventCode: 'signup_verification_incomplete',
        failureClass: 'incomplete_response',
        outcome: 'failed',
      })
    );
  });

  it('returns an actionable message for an invalid or expired signup code', async () => {
    mocks.verifyOtp.mockResolvedValue({
      data: { session: null, user: null },
      error: new Error('Token has expired or is invalid'),
    });

    await expect(
      runSignupOtpVerification({
        email: 'merchant@example.com',
        getCurrentUserId: () => undefined,
        onResetUserStores: vi.fn(),
        setState: vi.fn(),
        token: '000000',
      })
    ).resolves.toEqual({
      error:
        'That verification code is invalid or expired. Request a new code and try again.',
    });
    expect(mocks.captureMobileSignupLifecycle).toHaveBeenCalledWith(
      expect.objectContaining({
        eventCode: 'signup_verification_failed',
        failureClass: 'invalid_verification',
        outcome: 'failed',
      })
    );
  });

  it('preserves the signup attempt across verification start and provider failure', async () => {
    const attemptId = '123e4567-e89b-42d3-a456-426614174000';
    const verificationOptions = {
      attemptId,
      email: 'merchant@example.com',
      getCurrentUserId: () => undefined,
      onResetUserStores: vi.fn(),
      setState: vi.fn(),
      token: '000000',
    };
    mocks.verifyOtp.mockResolvedValue({
      data: { session: null, user: null },
      error: new Error('Token has expired'),
    });

    await runSignupOtpVerification(verificationOptions);

    expect(mocks.captureMobileSignupLifecycle).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        attemptId,
        eventCode: 'signup_verification_started',
      })
    );
    expect(mocks.captureMobileSignupLifecycle).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        attemptId,
        eventCode: 'signup_verification_failed',
      })
    );
  });

  it('preserves the staff cohort when provider verification fails', async () => {
    mocks.verifyOtp.mockResolvedValue({
      data: { session: null, user: null },
      error: new Error('Token has expired'),
    });

    await runSignupOtpVerification({
      attemptId: '123e4567-e89b-42d3-a456-426614174000',
      email: 'staff@example.com',
      flow: 'staff',
      getCurrentUserId: () => undefined,
      onResetUserStores: vi.fn(),
      setState: vi.fn(),
      token: '000000',
    });

    expect(mocks.captureMobileSignupLifecycle).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        eventCode: 'signup_verification_started',
        flow: 'staff',
      })
    );
    expect(mocks.captureMobileSignupLifecycle).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        eventCode: 'signup_verification_failed',
        flow: 'staff',
      })
    );
  });

  it('classifies a local session-commit failure as unexpected', async () => {
    const session = createSession();
    mocks.verifyOtp.mockResolvedValue({
      data: { session, user: session.user },
      error: null,
    });

    await runSignupOtpVerification({
      email: 'merchant@example.com',
      getCurrentUserId: () => 'prior-user',
      onResetUserStores: vi.fn().mockRejectedValue(new Error('cache failed')),
      setState: vi.fn(),
      token: '123456',
    });

    expect(mocks.captureMobileSignupLifecycle).toHaveBeenLastCalledWith(
      expect.objectContaining({
        eventCode: 'signup_verification_failed',
        failureClass: 'unexpected',
      })
    );
  });
});
