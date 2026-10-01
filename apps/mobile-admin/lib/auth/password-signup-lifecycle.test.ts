import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPasswordSignupLifecycle } from './password-signup-lifecycle';

const mocks = vi.hoisted(() => ({
  captureMobileSignupLifecycle: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/services/signup-lifecycle-telemetry', () => ({
  captureMobileSignupLifecycle: mocks.captureMobileSignupLifecycle,
}));

describe('createPasswordSignupLifecycle', () => {
  beforeEach(() => vi.clearAllMocks());

  it('adds stable attempt, flow, stage, and duration context', () => {
    const capture = createPasswordSignupLifecycle({
      attemptId: '123e4567-e89b-42d3-a456-426614174000',
      flow: 'merchant',
      startedAt: Date.now() - 25,
    });

    capture('password_signup_failed', 'failed', {
      failureClass: 'auth_provider',
    });

    expect(mocks.captureMobileSignupLifecycle).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptId: '123e4567-e89b-42d3-a456-426614174000',
        durationMs: expect.any(Number),
        eventCode: 'password_signup_failed',
        failureClass: 'auth_provider',
        flow: 'merchant',
        outcome: 'failed',
        stage: 'auth',
      })
    );
  });

  it('captures the default details path without a failure classification', () => {
    const capture = createPasswordSignupLifecycle({
      attemptId: '123e4567-e89b-42d3-a456-426614174000',
      flow: 'staff',
      startedAt: Date.now() - 25,
    });

    capture('password_signup_started', 'started');

    expect(mocks.captureMobileSignupLifecycle).toHaveBeenCalledWith({
      attemptId: '123e4567-e89b-42d3-a456-426614174000',
      durationMs: expect.any(Number),
      eventCode: 'password_signup_started',
      flow: 'staff',
      outcome: 'started',
      stage: 'auth',
    });
  });
});
