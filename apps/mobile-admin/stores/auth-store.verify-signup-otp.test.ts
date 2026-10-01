// biome-ignore-all assist/source/organizeImports: auth-store-test-utils must be imported before @/stores/auth-store — its module-level vi.mock registrations have to run first, and import sorting would reorder them (breaks the suite with a raw-TS transform error).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createSession,
  createSignedOutAuthState,
  mocks,
} from './auth-store-test-utils';
import { useAuthStore } from '@/stores/auth-store';

describe('useAuthStore verifySignupOtp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState(createSignedOutAuthState());
  });

  it('commits the exact verified signup session through the global auth store', async () => {
    const attemptId = '123e4567-e89b-42d3-a456-426614174000';
    const session = createSession('verified-user');
    mocks.verifyOtp.mockResolvedValue({
      data: { session, user: session.user },
      error: null,
    });

    const result = await useAuthStore
      .getState()
      .verifySignupOtp('merchant@example.test', '123456', attemptId);

    expect(result).toEqual({ error: null, sessionEstablished: true });
    expect(useAuthStore.getState()).toMatchObject({
      isAuthenticated: true,
      isInitialized: true,
      isLoading: false,
      session,
      user: session.user,
    });
    expect(mocks.clearAdminQueryCache).toHaveBeenCalledOnce();
    expect(mocks.captureMobileSignupLifecycle).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptId,
        eventCode: 'signup_verification_started',
        flow: 'merchant',
      })
    );
    expect(mocks.captureMobileSignupLifecycle).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptId,
        eventCode: 'signup_verification_succeeded',
        flow: 'merchant',
      })
    );
  });

  it('retains merchant verification context when Supabase rejects the OTP', async () => {
    const attemptId = '123e4567-e89b-42d3-a456-426614174000';
    mocks.verifyOtp.mockResolvedValue({
      data: { session: null, user: null },
      error: new Error('Token has expired'),
    });

    const result = await useAuthStore
      .getState()
      .verifySignupOtp('merchant@example.test', '000000', attemptId);

    expect(result).toEqual({
      error:
        'That verification code is invalid or expired. Request a new code and try again.',
    });
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(mocks.captureMobileSignupLifecycle).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        attemptId,
        eventCode: 'signup_verification_started',
        flow: 'merchant',
      })
    );
    expect(mocks.captureMobileSignupLifecycle).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        attemptId,
        eventCode: 'signup_verification_failed',
        failureClass: 'invalid_verification',
        flow: 'merchant',
      })
    );
  });

  it('retains merchant verification context when Supabase omits the session', async () => {
    const attemptId = '123e4567-e89b-42d3-a456-426614174000';
    mocks.verifyOtp.mockResolvedValue({
      data: { session: null, user: createSession().user },
      error: null,
    });

    const result = await useAuthStore
      .getState()
      .verifySignupOtp('merchant@example.test', '123456', attemptId);

    expect(result).toEqual({
      error:
        'Email verification did not finish. Request a new code and try again.',
    });
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(mocks.captureMobileSignupLifecycle).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        attemptId,
        eventCode: 'signup_verification_started',
        flow: 'merchant',
      })
    );
    expect(mocks.captureMobileSignupLifecycle).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        attemptId,
        eventCode: 'signup_verification_incomplete',
        failureClass: 'incomplete_response',
        flow: 'merchant',
      })
    );
  });

  it('forwards an explicit staff flow through signup verification telemetry', async () => {
    const attemptId = '123e4567-e89b-42d3-a456-426614174000';
    const session = createSession('verified-staff-user');
    mocks.verifyOtp.mockResolvedValue({
      data: { session, user: session.user },
      error: null,
    });

    const result = await useAuthStore
      .getState()
      .verifySignupOtp('staff@example.test', '123456', attemptId, 'staff');

    expect(result).toEqual({ error: null, sessionEstablished: true });
    expect(mocks.captureMobileSignupLifecycle).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        attemptId,
        eventCode: 'signup_verification_started',
        flow: 'staff',
      })
    );
    expect(mocks.captureMobileSignupLifecycle).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        attemptId,
        eventCode: 'signup_verification_succeeded',
        flow: 'staff',
      })
    );
  });
});
