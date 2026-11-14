import { describe, expect, it } from 'vitest';
import {
  idleInteractionSnapshot,
  mapOxygenLookupNetworkFailure,
  mapOxygenLookupResult,
} from './interaction';
import { failedSnapshot, lookupErr } from './interaction.test-helpers';

describe('mapOxygenLookupResult — error statuses', () => {
  it.each([
    'checking',
    'resuming',
  ] as const)('maps 404 to idle + discard from %s (access lost)', (from) => {
    const transition = mapOxygenLookupResult(lookupErr(404), from);
    expect(transition.snapshot).toEqual(idleInteractionSnapshot());
    expect(transition.clearOrderMarker).toBe(true);
    expect(transition.logHostError).toBe(false);
  });

  it.each([
    'checking',
    'resuming',
  ] as const)('maps 401 to reason-less signin-required with the marker kept from %s', (from) => {
    const transition = mapOxygenLookupResult(lookupErr(401), from);
    expect(transition.snapshot).toEqual({
      state: 'signin-required',
      recoveries: [],
    });
    expect(transition.clearOrderMarker).toBe(false);
  });

  it.each([
    'checking',
    'resuming',
  ] as const)('maps 400 to failed-with-no-recovery + host-error flag from %s', (from) => {
    const transition = mapOxygenLookupResult(lookupErr(400), from);
    expect(transition.snapshot).toEqual(failedSnapshot([]));
    expect(transition.logHostError).toBe(true);
    expect(transition.clearOrderMarker).toBe(false);
  });

  it.each([
    429, 500, 502, 503,
  ])('maps %s to failed-with-recheck (marker kept)', (status) => {
    for (const from of ['checking', 'resuming'] as const) {
      const transition = mapOxygenLookupResult(lookupErr(status), from);
      expect(transition.snapshot).toEqual(failedSnapshot(['recheck']));
      expect(transition.clearOrderMarker).toBe(false);
      expect(transition.logHostError).toBe(false);
    }
  });

  it('maps a CSRF-shaped 403 (no code) to failed-with-recheck', () => {
    for (const from of ['checking', 'resuming'] as const) {
      expect(mapOxygenLookupResult(lookupErr(403), from).snapshot).toEqual(
        failedSnapshot(['recheck'])
      );
    }
  });

  it('maps even a coded 403 on GET to failed-with-recheck (GET denies are 200)', () => {
    const transition = mapOxygenLookupResult(
      lookupErr(403, 'oxygen_rollout_disabled'),
      'checking'
    );
    expect(transition.snapshot).toEqual(failedSnapshot(['recheck']));
  });

  it('maps unknown statuses closed to failed-with-recheck', () => {
    expect(mapOxygenLookupResult(lookupErr(418), 'checking').snapshot).toEqual(
      failedSnapshot(['recheck'])
    );
  });

  it('maps a network failure to failed-with-recheck, never a discard', () => {
    for (const from of ['checking', 'resuming'] as const) {
      const transition = mapOxygenLookupNetworkFailure(from);
      expect(transition.snapshot).toEqual(failedSnapshot(['recheck']));
      expect(transition.clearOrderMarker).toBe(false);
      expect(transition.logHostError).toBe(false);
    }
  });
});
