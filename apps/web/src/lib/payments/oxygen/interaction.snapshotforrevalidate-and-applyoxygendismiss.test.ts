import { describe, expect, it } from 'vitest';
import {
  applyOxygenDismiss,
  idleInteractionSnapshot,
  type OxygenInteractionSnapshot,
  type OxygenInteractionState,
  snapshotForRevalidate,
} from './interaction';

describe('snapshotForRevalidate and applyOxygenDismiss', () => {
  it('revalidates to resuming with a marker, checking without', () => {
    expect(snapshotForRevalidate(true)).toEqual({
      state: 'resuming',
      recoveries: [],
    });
    expect(snapshotForRevalidate(false)).toEqual({
      state: 'checking',
      recoveries: [],
    });
  });

  it('ignores dismiss while initiating (no dismiss, marker untouched)', () => {
    const snapshot: OxygenInteractionSnapshot = {
      state: 'initiating',
      recoveries: [],
    };
    const transition = applyOxygenDismiss(snapshot);
    expect(transition.ignored).toBe(true);
    expect(transition.snapshot).toBe(snapshot);
    expect(transition.clearOrderMarker).toBe(false);
  });

  it('ignores dismiss while idle without clearing markers', () => {
    const snapshot = idleInteractionSnapshot();
    const transition = applyOxygenDismiss(snapshot);
    expect(transition.ignored).toBe(true);
    expect(transition.snapshot).toBe(snapshot);
    expect(transition.clearOrderMarker).toBe(false);
  });

  it.each([
    'checking',
    'ready',
    'unavailable',
    'signin-required',
    'handed-off',
    'resuming',
    'failed',
  ] as OxygenInteractionState[])('dismisses %s to idle + clear', (state) => {
    const transition = applyOxygenDismiss({
      state,
      reason: 'oxygen_rollout_disabled',
      recoveries: ['recheck', 'resubmit'],
    });
    expect(transition.ignored).toBe(false);
    expect(transition.snapshot).toEqual(idleInteractionSnapshot());
    expect(transition.clearOrderMarker).toBe(true);
  });
});
