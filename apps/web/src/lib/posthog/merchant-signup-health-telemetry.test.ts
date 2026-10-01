import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  captureServerEvent: vi.fn(),
  captureServerException: vi.fn(),
  getPostHogReleaseContext: vi.fn(),
}));

vi.mock('@/lib/posthog/server', () => ({
  captureServerEvent: mocks.captureServerEvent,
  captureServerException: mocks.captureServerException,
}));

vi.mock('@/lib/posthog/config', () => ({
  getPostHogReleaseContext: mocks.getPostHogReleaseContext,
}));

import { recordMerchantSignupHealthTelemetry } from './merchant-signup-health-telemetry';

describe('recordMerchantSignupHealthTelemetry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.captureServerEvent.mockResolvedValue(true);
    mocks.captureServerException.mockResolvedValue(true);
    mocks.getPostHogReleaseContext.mockReturnValue({
      release_version: 'release-123',
    });
  });

  it('records policy drift as an alertable aggregate without customer data', async () => {
    await recordMerchantSignupHealthTelemetry({
      durationMs: 72,
      failedInvariants: ['auth_can_insert', 'select_policy_is_expected'],
      outcome: 'degraded',
      reason: 'policy_drift_detected',
    });

    expect(mocks.captureServerEvent).toHaveBeenCalledWith(
      'admin_signup_health',
      {
        duration_ms: 72,
        failed_invariant_count: 2,
        failed_invariants: ['auth_can_insert', 'select_policy_is_expected'],
        health_component: 'merchant_signup_policy',
        health_outcome: 'degraded',
        reason: 'policy_drift_detected',
        release_version: 'release-123',
        telemetry_source: 'scheduled_health_check',
      }
    );
  });

  it('removes malformed health metadata before capture', async () => {
    await recordMerchantSignupHealthTelemetry({
      durationMs: -1,
      failedInvariants: ['auth_can_insert', 'password=secret'],
      outcome: 'unavailable',
      postgresCode: '42501;secret',
      reason: 'health rpc failed',
    });

    expect(mocks.captureServerEvent).toHaveBeenCalledWith(
      'admin_signup_health',
      expect.objectContaining({
        duration_ms: 0,
        failed_invariant_count: 1,
        failed_invariants: ['auth_can_insert'],
        reason: 'unavailable',
      })
    );
    const capturedProperties = mocks.captureServerEvent.mock.calls[0]?.[1];
    expect(capturedProperties).not.toHaveProperty('postgres_code');
    expect(JSON.stringify(capturedProperties)).not.toContain('secret');
  });

  it('captures thrown health-check errors through sanitized exception tracking', async () => {
    const error = new Error('password=secret');

    await recordMerchantSignupHealthTelemetry({
      durationMs: 15,
      error,
      outcome: 'unavailable',
      reason: 'health_rpc_threw',
    });

    expect(mocks.captureServerException).toHaveBeenCalledWith(
      error,
      expect.objectContaining({
        health_component: 'merchant_signup_policy',
        route_path: '/api/cron/merchant-signup-health',
      })
    );
    expect(
      JSON.stringify(mocks.captureServerEvent.mock.calls[0])
    ).not.toContain('secret');
  });
});
