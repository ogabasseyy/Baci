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

import { recordMobileSignupLifecycle } from './mobile-signup-lifecycle-telemetry';

describe('recordMobileSignupLifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.captureServerEvent.mockResolvedValue(true);
    mocks.captureServerException.mockResolvedValue(true);
    mocks.getPostHogReleaseContext.mockReturnValue({
      release_version: 'release-123',
    });
  });

  it('records an authoritative correlated provisioning outcome', async () => {
    await recordMobileSignupLifecycle({
      attemptId: '123e4567-e89b-42d3-a456-426614174000',
      durationMs: 812,
      eventCode: 'merchant_provisioning_succeeded',
      httpStatus: 200,
      outcome: 'succeeded',
      platform: 'ios',
      stage: 'provisioning',
    });

    expect(mocks.captureServerEvent).toHaveBeenCalledWith(
      'admin_signup_lifecycle',
      {
        duration_ms: 812,
        event_code: 'merchant_provisioning_succeeded',
        http_status: 200,
        platform: 'ios',
        release_version: 'release-123',
        signup_attempt_id: '123e4567-e89b-42d3-a456-426614174000',
        signup_flow: 'merchant',
        signup_outcome: 'succeeded',
        signup_stage: 'provisioning',
        telemetry_source: 'provisioning_api',
      }
    );
    expect(mocks.captureServerException).not.toHaveBeenCalled();
  });

  it('captures unexpected failures separately without putting raw error text in the lifecycle event', async () => {
    const error = Object.assign(new Error('password=secret'), {
      code: '42501',
    });

    await recordMobileSignupLifecycle({
      attemptId: null,
      captureException: true,
      durationMs: 50,
      error,
      eventCode: 'merchant_provisioning_failed',
      failureClass: 'database',
      httpStatus: 500,
      outcome: 'failed',
      platform: 'android',
      postgresCode: '42501',
      stage: 'rpc',
    });

    const lifecyclePayload = JSON.stringify(
      mocks.captureServerEvent.mock.calls[0]
    );
    expect(lifecyclePayload).not.toContain('password');
    expect(lifecyclePayload).not.toContain('secret');
    expect(mocks.captureServerException).toHaveBeenCalledWith(
      error,
      expect.objectContaining({
        event_code: 'merchant_provisioning_failed',
        failure_class: 'database',
        route_path: '/api/mobile/merchant-provisioning',
      })
    );
  });

  it('omits an unsafe database code and clamps a negative duration', async () => {
    const error = new Error('failed');

    await recordMobileSignupLifecycle({
      attemptId: null,
      captureException: true,
      durationMs: -25,
      error,
      eventCode: 'merchant_provisioning_failed',
      failureClass: 'database',
      httpStatus: 500,
      outcome: 'failed',
      platform: 'ios',
      postgresCode: 'owner@example.com password=secret',
      stage: 'rpc',
    });

    const lifecycleProperties = mocks.captureServerEvent.mock.calls[0]?.[1];
    const exceptionContext = mocks.captureServerException.mock.calls[0]?.[1];
    expect(lifecycleProperties).toEqual(
      expect.objectContaining({ duration_ms: 0 })
    );
    expect(lifecycleProperties).not.toHaveProperty('postgres_code');
    expect(mocks.captureServerException).toHaveBeenCalled();
    expect(exceptionContext).toBeDefined();
    expect(exceptionContext).not.toHaveProperty('postgres_code');
    expect(JSON.stringify(exceptionContext ?? {})).not.toContain('secret');
  });

  it('logs a stable telemetry gap without changing the caller outcome', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.captureServerEvent.mockResolvedValue(false);

    await expect(
      recordMobileSignupLifecycle({
        attemptId: null,
        durationMs: 10,
        eventCode: 'merchant_provisioning_failed',
        failureClass: 'validation',
        httpStatus: 400,
        outcome: 'failed',
        platform: null,
        stage: 'input',
      })
    ).resolves.toBeUndefined();

    expect(warning).toHaveBeenCalledWith(
      'mobile_signup_lifecycle_telemetry_gap %s',
      expect.stringContaining('merchant_provisioning_failed')
    );
    warning.mockRestore();
  });
});
