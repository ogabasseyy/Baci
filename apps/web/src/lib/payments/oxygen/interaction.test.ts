import { describe, expect, it } from 'vitest';
import {
  idleInteractionSnapshot,
  isOxygenInteractionReason,
  isOxygenInteractionState,
  OXYGEN_INTERACTION_REASON_LIST,
  OXYGEN_INTERACTION_STATE_LIST,
} from './interaction';
import {
  ALL_STATES,
  FIXTURE_EMAIL,
  FIXTURE_ORDER_ID,
  SIX_REASONS,
} from './interaction.test-helpers';

describe('machine states and reason taxonomy', () => {
  it('exposes exactly the nine machine states', () => {
    expect([...OXYGEN_INTERACTION_STATE_LIST]).toEqual(ALL_STATES);
  });

  it('exposes exactly the six S-03 reasons', () => {
    expect([...OXYGEN_INTERACTION_REASON_LIST]).toEqual(SIX_REASONS);
  });

  it.each(ALL_STATES)('accepts %s as a machine state', (state) => {
    expect(isOxygenInteractionState(state)).toBe(true);
  });

  it('rejects non-state inputs (ids, typos, non-strings)', () => {
    expect(isOxygenInteractionState(FIXTURE_ORDER_ID)).toBe(false);
    expect(isOxygenInteractionState('interrupted')).toBe(false);
    expect(isOxygenInteractionState('approved')).toBe(false);
    expect(isOxygenInteractionState('')).toBe(false);
    expect(isOxygenInteractionState(undefined)).toBe(false);
    expect(isOxygenInteractionState(null)).toBe(false);
    expect(isOxygenInteractionState(42)).toBe(false);
    expect(isOxygenInteractionState({})).toBe(false);
  });

  it.each(SIX_REASONS)('accepts %s as a reason', (reason) => {
    expect(isOxygenInteractionReason(reason)).toBe(true);
  });

  it('rejects non-reason inputs', () => {
    expect(isOxygenInteractionReason(FIXTURE_ORDER_ID)).toBe(false);
    expect(isOxygenInteractionReason(FIXTURE_EMAIL)).toBe(false);
    expect(isOxygenInteractionReason('oxygen_provider_unavailable')).toBe(
      false
    );
    expect(isOxygenInteractionReason('')).toBe(false);
    expect(isOxygenInteractionReason(undefined)).toBe(false);
    expect(isOxygenInteractionReason(null)).toBe(false);
    expect(isOxygenInteractionReason(0)).toBe(false);
  });

  it('builds a fresh idle snapshot on every call', () => {
    expect(idleInteractionSnapshot()).toEqual({
      state: 'idle',
      recoveries: [],
    });
    expect(idleInteractionSnapshot()).not.toBe(idleInteractionSnapshot());
    expect(idleInteractionSnapshot().recoveries).not.toBe(
      idleInteractionSnapshot().recoveries
    );
  });
});
