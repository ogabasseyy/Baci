import { beforeEach, describe, expect, it, vi } from 'vitest';
import { captureMobileSignupLifecycle } from './signup-lifecycle-telemetry';

const mocks = vi.hoisted(() => ({
  capture: vi.fn(),
  fetch: vi.fn(),
  getAdminPostHog: vi.fn(),
  initAdminAnalytics: vi.fn(),
}));

vi.mock('@react-native-community/netinfo', () => ({
  default: { fetch: mocks.fetch },
}));

vi.mock('expo-application', () => ({
  nativeApplicationVersion: '2.0.432',
  nativeBuildVersion: '432',
}));

vi.mock('@/services/analytics-core', () => ({
  getAdminPostHog: mocks.getAdminPostHog,
  initAdminAnalytics: mocks.initAdminAnalytics,
}));

describe('captureMobileSignupLifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAdminPostHog.mockReturnValue({ capture: mocks.capture });
    mocks.initAdminAnalytics.mockReturnValue(true);
    mocks.fetch.mockResolvedValue({
      isConnected: true,
      isInternetReachable: true,
      type: 'cellular',
    });
  });

  it('captures a correlated failure with operational context and no raw customer data', async () => {
    await captureMobileSignupLifecycle({
      attemptId: '123e4567-e89b-42d3-a456-426614174000',
      durationMs: 321,
      error: {
        code: 'AuthRetryableFetchError',
        message:
          'fetch https://secret.supabase.co failed for owner@example.com using password hunter2',
        status: 0,
      },
      eventCode: 'password_signup_connectivity_error',
      failureClass: 'connectivity_dns',
      flow: 'merchant',
      outcome: 'failed',
      retryAttempted: true,
      stage: 'auth',
    });

    expect(mocks.capture).toHaveBeenCalledWith('admin_signup_lifecycle', {
      app_surface: 'mobile-admin',
      duration_ms: 321,
      error_code: 'AuthRetryableFetchError',
      error_status: 0,
      event_code: 'password_signup_connectivity_error',
      failure_class: 'connectivity_dns',
      native_app_version: '2.0.432',
      native_build_version: '432',
      network_is_connected: true,
      network_is_internet_reachable: true,
      network_snapshot_available: true,
      network_type: 'cellular',
      retry_attempted: true,
      signup_attempt_id: '123e4567-e89b-42d3-a456-426614174000',
      signup_flow: 'merchant',
      signup_outcome: 'failed',
      signup_stage: 'auth',
      telemetry_source: 'mobile',
    });

    const capturedPayload = JSON.stringify(mocks.capture.mock.calls[0]);
    expect(capturedPayload).not.toContain('secret.supabase.co');
    expect(capturedPayload).not.toContain('owner@example.com');
    expect(capturedPayload).not.toContain('hunter2');
  });

  it('captures ordinary steps immediately and omits an invalid attempt id', async () => {
    await expect(
      captureMobileSignupLifecycle({
        attemptId: 'owner@example.com',
        eventCode: 'signup_started',
        flow: 'merchant',
        outcome: 'started',
        stage: 'auth',
      })
    ).resolves.toBeUndefined();

    const capturedProperties = mocks.capture.mock.calls[0]?.[1];
    expect(capturedProperties).toEqual(
      expect.objectContaining({
        error_code: 'unavailable',
        network_snapshot_available: false,
      })
    );
    expect(capturedProperties).not.toHaveProperty('signup_attempt_id');
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('prefers a finite status and falls back to a finite statusCode', async () => {
    await captureMobileSignupLifecycle({
      attemptId: null,
      error: { status: Number.NaN, statusCode: 503 },
      eventCode: 'signup_verification_failed',
      flow: 'merchant',
      outcome: 'failed',
      stage: 'verification',
    });

    expect(mocks.capture).toHaveBeenLastCalledWith(
      'admin_signup_lifecycle',
      expect.objectContaining({ error_status: 503 })
    );

    await captureMobileSignupLifecycle({
      attemptId: null,
      error: { status: 502, statusCode: 503 },
      eventCode: 'signup_verification_failed',
      flow: 'merchant',
      outcome: 'failed',
      stage: 'verification',
    });

    expect(mocks.capture).toHaveBeenLastCalledWith(
      'admin_signup_lifecycle',
      expect.objectContaining({ error_status: 502 })
    );
  });

  it('resolves when analytics capture throws', async () => {
    mocks.capture.mockImplementation(() => {
      throw new Error('capture failed');
    });

    await expect(
      captureMobileSignupLifecycle({
        attemptId: '123e4567-e89b-42d3-a456-426614174000',
        eventCode: 'signup_started',
        flow: 'merchant',
        outcome: 'started',
        stage: 'auth',
      })
    ).resolves.toBeUndefined();
  });

  it('captures a connectivity failure when the network snapshot is unavailable', async () => {
    mocks.fetch.mockRejectedValue(new Error('netinfo unavailable'));

    await captureMobileSignupLifecycle({
      attemptId: '123e4567-e89b-42d3-a456-426614174000',
      eventCode: 'password_signup_connectivity_error',
      failureClass: 'connectivity_dns',
      flow: 'merchant',
      outcome: 'failed',
      stage: 'auth',
    });

    expect(mocks.capture).toHaveBeenCalledWith(
      'admin_signup_lifecycle',
      expect.objectContaining({
        network_snapshot_available: false,
        network_type: 'unknown',
      })
    );
  });

  it('does nothing when production analytics cannot initialize', async () => {
    mocks.getAdminPostHog.mockReturnValue(null);
    mocks.initAdminAnalytics.mockReturnValue(false);

    await captureMobileSignupLifecycle({
      attemptId: null,
      eventCode: 'signup_started',
      flow: 'merchant',
      outcome: 'started',
      stage: 'auth',
    });

    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.capture).not.toHaveBeenCalled();
  });
});
