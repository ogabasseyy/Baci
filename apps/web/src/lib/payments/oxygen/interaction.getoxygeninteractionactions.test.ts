import { describe, expect, it } from 'vitest';
import {
  getOxygenInteractionActions,
  OXYGEN_INTERACTION_ACTION_LABELS,
  type OxygenFailedRecovery,
  type OxygenInteractionAction,
  type OxygenInteractionSnapshot,
  type OxygenInteractionState,
} from './interaction';
import { FIXTURE_ORDER_ID, failedSnapshot } from './interaction.test-helpers';

describe('getOxygenInteractionActions', () => {
  it('offers nothing while idle, checking, resuming, or initiating', () => {
    for (const state of [
      'idle',
      'checking',
      'resuming',
      'initiating',
    ] as OxygenInteractionState[]) {
      expect(getOxygenInteractionActions({ state, recoveries: [] })).toEqual(
        []
      );
    }
  });

  it('offers submit + dismiss while ready', () => {
    expect(
      getOxygenInteractionActions({ state: 'ready', recoveries: [] })
    ).toEqual(['submit', 'dismiss']);
  });

  it('offers recheck + dismiss while unavailable', () => {
    expect(
      getOxygenInteractionActions({
        state: 'unavailable',
        reason: 'oxygen_rollout_disabled',
        recoveries: [],
      })
    ).toEqual(['recheck', 'dismiss']);
  });

  it('offers signin + dismiss while signin-required', () => {
    expect(
      getOxygenInteractionActions({ state: 'signin-required', recoveries: [] })
    ).toEqual(['signin', 'dismiss']);
  });

  it('offers dismiss only once handed-off (explicit abandon)', () => {
    expect(
      getOxygenInteractionActions({ state: 'handed-off', recoveries: [] })
    ).toEqual(['dismiss']);
  });

  it('offers dismiss only for failed-with-no-recovery (400 path)', () => {
    expect(getOxygenInteractionActions(failedSnapshot([]))).toEqual([
      'dismiss',
    ]);
  });

  it('offers recheck + dismiss for failed-with-recheck (lookup path)', () => {
    expect(getOxygenInteractionActions(failedSnapshot(['recheck']))).toEqual([
      'recheck',
      'dismiss',
    ]);
  });

  it('offers submit + dismiss for failed-with-resubmit', () => {
    expect(getOxygenInteractionActions(failedSnapshot(['resubmit']))).toEqual([
      'submit',
      'dismiss',
    ]);
  });

  it('offers recheck, submit, then dismiss when both recoveries are present', () => {
    expect(
      getOxygenInteractionActions(failedSnapshot(['recheck', 'resubmit']))
    ).toEqual(['recheck', 'submit', 'dismiss']);
    expect(
      getOxygenInteractionActions(failedSnapshot(['resubmit', 'recheck']))
    ).toEqual(['recheck', 'submit', 'dismiss']);
  });

  it('dedupes and drops unknown recoveries', () => {
    expect(
      getOxygenInteractionActions(
        failedSnapshot([
          'recheck',
          'recheck',
          'handover' as OxygenFailedRecovery,
        ])
      )
    ).toEqual(['recheck', 'dismiss']);
  });

  it('tolerates a missing recoveries list and unknown states', () => {
    expect(
      getOxygenInteractionActions({
        state: 'failed',
      } as OxygenInteractionSnapshot)
    ).toEqual(['dismiss']);
    expect(
      getOxygenInteractionActions({
        state: FIXTURE_ORDER_ID as OxygenInteractionState,
        recoveries: [],
      })
    ).toEqual([]);
  });

  it('pins the button labels', () => {
    const labels: Record<OxygenInteractionAction, string> =
      OXYGEN_INTERACTION_ACTION_LABELS;
    expect(labels).toEqual({
      signin: 'Sign in',
      recheck: 'Check again',
      submit: 'Continue with Oxygen',
      dismiss: 'Dismiss',
    });
  });
});
