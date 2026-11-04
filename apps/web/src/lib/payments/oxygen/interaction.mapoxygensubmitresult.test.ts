import { describe, expect, it } from 'vitest';
import {
  idleInteractionSnapshot,
  mapOxygenSubmitNetworkFailure,
  mapOxygenSubmitResult,
} from './interaction';
import {
  failedSnapshot,
  SIX_REASONS,
  submitErr,
} from './interaction.test-helpers';

describe('mapOxygenSubmitResult', () => {
  it('maps 2xx to handed-off with the handoff flag (payload ignored)', () => {
    const transition = mapOxygenSubmitResult({ ok: true });
    expect(transition.snapshot).toEqual({
      state: 'handed-off',
      recoveries: [],
    });
    expect(transition.handoff).toBe(true);
    expect(transition.clearOrderMarker).toBe(false);
    expect(transition.logHostError).toBe(false);
  });

  it.each(
    SIX_REASONS
  )('maps a coded 403 (%s) to unavailable with the reason', (reason) => {
    const transition = mapOxygenSubmitResult(submitErr(403, reason));
    expect(transition.snapshot).toEqual({
      state: 'unavailable',
      reason,
      recoveries: [],
    });
    expect(transition.handoff).toBe(false);
    expect(transition.clearOrderMarker).toBe(false);
  });

  it('maps a codeless 403 (CSRF shape) to failed-with-both, never unavailable', () => {
    const transition = mapOxygenSubmitResult(submitErr(403));
    expect(transition.snapshot).toEqual(
      failedSnapshot(['recheck', 'resubmit'])
    );
    expect(transition.handoff).toBe(false);
  });

  it('maps an empty-string code like a missing code', () => {
    expect(mapOxygenSubmitResult(submitErr(403, '')).snapshot).toEqual(
      failedSnapshot(['recheck', 'resubmit'])
    );
  });

  it('maps an unknown 403 code closed to failed-with-both', () => {
    const transition = mapOxygenSubmitResult(
      submitErr(403, 'oxygen_provider_unavailable')
    );
    expect(transition.snapshot).toEqual(
      failedSnapshot(['recheck', 'resubmit'])
    );
  });

  it('maps a non-string 403 code closed to failed-with-both', () => {
    const transition = mapOxygenSubmitResult({
      ok: false,
      status: 403,
      code: 403 as unknown as string,
    });
    expect(transition.snapshot).toEqual(
      failedSnapshot(['recheck', 'resubmit'])
    );
  });

  it('maps 404 to idle + discard (access lost)', () => {
    const transition = mapOxygenSubmitResult(submitErr(404));
    expect(transition.snapshot).toEqual(idleInteractionSnapshot());
    expect(transition.clearOrderMarker).toBe(true);
    expect(transition.handoff).toBe(false);
  });

  it('maps 401 to reason-less signin-required with the marker kept', () => {
    const transition = mapOxygenSubmitResult(submitErr(401));
    expect(transition.snapshot).toEqual({
      state: 'signin-required',
      recoveries: [],
    });
    expect(transition.clearOrderMarker).toBe(false);
    expect(transition.handoff).toBe(false);
  });

  it('maps 400 to failed-with-no-recovery + host-error flag', () => {
    const transition = mapOxygenSubmitResult(submitErr(400));
    expect(transition.snapshot).toEqual(failedSnapshot([]));
    expect(transition.logHostError).toBe(true);
    expect(transition.handoff).toBe(false);
  });

  it.each([
    429, 500, 502, 503,
  ])('maps %s to failed-with-both (resubmit stays offered)', (status) => {
    const transition = mapOxygenSubmitResult(submitErr(status));
    expect(transition.snapshot).toEqual(
      failedSnapshot(['recheck', 'resubmit'])
    );
    expect(transition.handoff).toBe(false);
    expect(transition.logHostError).toBe(false);
  });

  it('maps unknown statuses closed to failed-with-both', () => {
    expect(mapOxygenSubmitResult(submitErr(418)).snapshot).toEqual(
      failedSnapshot(['recheck', 'resubmit'])
    );
  });

  it('maps a network failure to failed-with-both', () => {
    const transition = mapOxygenSubmitNetworkFailure();
    expect(transition.snapshot).toEqual(
      failedSnapshot(['recheck', 'resubmit'])
    );
    expect(transition.handoff).toBe(false);
    expect(transition.clearOrderMarker).toBe(false);
    expect(transition.logHostError).toBe(false);
  });
});
