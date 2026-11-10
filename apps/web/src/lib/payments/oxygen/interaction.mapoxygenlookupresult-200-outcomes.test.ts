import { describe, expect, it } from 'vitest';
import { mapOxygenLookupResult } from './interaction';
import {
  FIXTURE_ORDER_ID,
  failedSnapshot,
  lookupOk,
  SIX_REASONS,
} from './interaction.test-helpers';

describe('mapOxygenLookupResult — 200 outcomes', () => {
  it.each([
    'checking',
    'resuming',
  ] as const)('maps 200 available to ready from %s', (from) => {
    const transition = mapOxygenLookupResult(lookupOk(true), from);
    expect(transition.snapshot).toEqual({
      state: 'ready',
      recoveries: [],
    });
    expect(transition.logHostError).toBe(false);
  });

  it('consumes the marker on resume-complete, keeps it on a fresh check', () => {
    expect(
      mapOxygenLookupResult(lookupOk(true), 'resuming').clearOrderMarker
    ).toBe(true);
    expect(
      mapOxygenLookupResult(lookupOk(true), 'checking').clearOrderMarker
    ).toBe(false);
  });

  it.each(
    SIX_REASONS.filter((reason) => reason !== 'oxygen_guest_not_allowed')
  )('maps 200 deny (%s) to unavailable with the reason kept', (reason) => {
    for (const from of ['checking', 'resuming'] as const) {
      const transition = mapOxygenLookupResult(lookupOk(false, reason), from);
      expect(transition.snapshot).toEqual({
        state: 'unavailable',
        reason,
        recoveries: [],
      });
      expect(transition.clearOrderMarker).toBe(false);
      expect(transition.logHostError).toBe(false);
    }
  });

  it('maps the guest deny to signin-required regardless of the local session', () => {
    for (const from of ['checking', 'resuming'] as const) {
      const transition = mapOxygenLookupResult(
        lookupOk(false, 'oxygen_guest_not_allowed'),
        from
      );
      expect(transition.snapshot).toEqual({
        state: 'signin-required',
        reason: 'oxygen_guest_not_allowed',
        recoveries: [],
      });
      expect(transition.clearOrderMarker).toBe(false);
    }
  });

  it('fails a deny with a missing reason closed to retryable failure', () => {
    for (const from of ['checking', 'resuming'] as const) {
      const transition = mapOxygenLookupResult(lookupOk(false), from);
      expect(transition.snapshot).toEqual(failedSnapshot(['recheck']));
      expect(transition.clearOrderMarker).toBe(false);
    }
  });

  it('fails a deny with an unknown reason closed to retryable failure', () => {
    for (const from of ['checking', 'resuming'] as const) {
      const transition = mapOxygenLookupResult(
        lookupOk(false, FIXTURE_ORDER_ID),
        from
      );
      expect(transition.snapshot).toEqual(failedSnapshot(['recheck']));
      expect(transition.clearOrderMarker).toBe(false);
    }
  });

  it('fails a deny with a non-string reason closed to retryable failure', () => {
    const transition = mapOxygenLookupResult(
      { ok: true, available: false, reason: 42 as unknown as string },
      'checking'
    );
    expect(transition.snapshot).toEqual(failedSnapshot(['recheck']));
  });

  it('requires a strict available flag; truthy garbage denies closed', () => {
    const transition = mapOxygenLookupResult(
      { ok: true, available: 'yes' as unknown as boolean },
      'checking'
    );
    expect(transition.snapshot).toEqual(failedSnapshot(['recheck']));
  });
});
