import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runPasswordSignUp } from './sign-up-with-password';

const mocks = vi.hoisted(() => ({
  captureMobileSignupLifecycle: vi.fn().mockResolvedValue(undefined),
  checkPasswordBreach: vi.fn(),
  generateUUID: vi.fn(() => '123e4567-e89b-42d3-a456-426614174000'),
  signUp: vi.fn(),
  trackAuthTelemetry: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { signUp: mocks.signUp } },
}));

vi.mock('@/lib/auth/check-password-breach', () => ({
  checkPasswordBreach: mocks.checkPasswordBreach,
}));

vi.mock('@/services/signup-lifecycle-telemetry', () => ({
  captureMobileSignupLifecycle: mocks.captureMobileSignupLifecycle,
}));

vi.mock('@/utils/uuid', () => ({ generateUUID: mocks.generateUUID }));

vi.mock('@/services/auth-telemetry', () => ({
  trackAuthTelemetry: mocks.trackAuthTelemetry,
}));

const DNS_ERROR = new Error(
  'fetch failed: A server with the specified hostname could not be found.'
);

function makeOptions() {
  return {
    email: 'staff@example.com',
    password: 'sup3r-secret-pw',
    signupFlow: 'merchant' as const,
    getCurrentUserId: vi.fn(() => undefined),
    onResetUserStores: vi.fn().mockResolvedValue(undefined),
    setState: vi.fn(),
  };
}

function makeResponse(error: Error | null) {
  return {
    data: {
      session: null,
      user: error ? null : { id: 'user-1', identities: [{ id: 'identity-1' }] },
    },
    error,
  };
}

describe('bugfix: password signup connectivity failures', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkPasswordBreach.mockResolvedValue({ isBreached: false });
  });

  it('retries the exact returned iOS DNS failure once and succeeds', async () => {
    mocks.signUp
      .mockResolvedValueOnce(makeResponse(DNS_ERROR))
      .mockResolvedValueOnce(makeResponse(null));

    const result = await runPasswordSignUp(makeOptions());

    expect(result).toEqual({
      error: null,
      needsEmailConfirmation: true,
      signupAttemptId: '123e4567-e89b-42d3-a456-426614174000',
    });
    expect(mocks.signUp).toHaveBeenCalledTimes(2);
    expect(mocks.captureMobileSignupLifecycle).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptId: '123e4567-e89b-42d3-a456-426614174000',
        eventCode: 'password_signup_dns_retry',
        error: DNS_ERROR,
        failureClass: 'connectivity_dns',
        flow: 'merchant',
        outcome: 'retrying',
        retryAttempted: true,
        stage: 'auth',
      })
    );
    expect(mocks.trackAuthTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'password_signup_dns_retry',
        level: 'warn',
        metadata: { retryAttempted: true },
      })
    );
    expect(mocks.trackAuthTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { dnsRetryAttempted: true, hasSession: false },
        stage: 'success',
      })
    );
  });

  it('stops after one DNS retry and returns a customer-safe failure', async () => {
    mocks.signUp.mockResolvedValue(makeResponse(DNS_ERROR));

    const result = await runPasswordSignUp(makeOptions());

    expect(result).toEqual({
      error: 'Unable to connect. Please check your internet connection.',
    });
    expect(mocks.signUp).toHaveBeenCalledTimes(2);
    expect(mocks.captureMobileSignupLifecycle).toHaveBeenLastCalledWith(
      expect.objectContaining({
        eventCode: 'password_signup_connectivity_error',
        error: DNS_ERROR,
        failureClass: 'connectivity_dns',
        outcome: 'failed',
        retryAttempted: true,
      })
    );
  });

  it('does not retry an ambiguous transport failure', async () => {
    const transportError = new Error('fetch failed: Network request failed');
    mocks.signUp.mockResolvedValue(makeResponse(transportError));

    const result = await runPasswordSignUp(makeOptions());

    expect(result).toEqual({
      error: 'Unable to connect. Please check your internet connection.',
    });
    expect(mocks.signUp).toHaveBeenCalledTimes(1);
    expect(mocks.captureMobileSignupLifecycle).toHaveBeenCalledTimes(2);
    expect(mocks.captureMobileSignupLifecycle).toHaveBeenLastCalledWith(
      expect.objectContaining({
        eventCode: 'password_signup_connectivity_error',
        error: transportError,
        failureClass: 'connectivity_transport',
        outcome: 'failed',
        retryAttempted: false,
      })
    );
  });
});
