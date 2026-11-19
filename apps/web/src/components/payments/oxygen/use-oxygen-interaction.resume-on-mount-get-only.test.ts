import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  OXYGEN_HANDOFF_MARKER_TTL_MS,
  oxygenHandoffMarkerKey,
  readOxygenHandoffMarker,
  writeOxygenHandoffMarker,
} from '@/lib/payments/oxygen/interaction';
import { useOxygenInteraction } from './use-oxygen-interaction';
import {
  createHarness,
  lookupErr,
  lookupOk,
  NOW,
  ORDER_A,
  propsFor,
  resolveLookup,
  setupInteractionTests,
} from './use-oxygen-interaction.test-helpers';

setupInteractionTests();

describe('resume-on-mount (GET-only)', () => {
  it('mounts with a valid marker into resuming without submit or handoff', () => {
    const harness = createHarness();
    writeOxygenHandoffMarker(harness.storage, ORDER_A, NOW);
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness))
    );
    expect(result.current.state).toBe('resuming');
    expect(harness.lookup).toHaveBeenCalledTimes(1);
    expect(harness.lookup).toHaveBeenCalledWith(ORDER_A);
    expect(harness.submit).not.toHaveBeenCalled();
    expect(harness.onSecureFormRequest).not.toHaveBeenCalled();
  });

  it('consumes the marker on resume-complete', async () => {
    const harness = createHarness();
    writeOxygenHandoffMarker(harness.storage, ORDER_A, NOW);
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness))
    );
    await resolveLookup(harness, 0, lookupOk(true));
    expect(result.current.state).toBe('ready');
    expect(harness.storage.getItem(oxygenHandoffMarkerKey(ORDER_A))).toBeNull();
  });

  it('keeps the marker on a resume deny', async () => {
    const harness = createHarness();
    writeOxygenHandoffMarker(harness.storage, ORDER_A, NOW);
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness))
    );
    await resolveLookup(
      harness,
      0,
      lookupOk(false, 'oxygen_provider_unverified')
    );
    expect(result.current.state).toBe('unavailable');
    expect(
      readOxygenHandoffMarker(harness.storage, ORDER_A, NOW)
    ).not.toBeNull();
  });

  it('keeps the marker on a resume transient; recheck resumes again', async () => {
    const harness = createHarness();
    writeOxygenHandoffMarker(harness.storage, ORDER_A, NOW);
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness))
    );
    await resolveLookup(harness, 0, lookupErr(503));
    expect(result.current.state).toBe('failed');
    expect(result.current.recoveries).toEqual(['recheck']);
    expect(
      readOxygenHandoffMarker(harness.storage, ORDER_A, NOW)
    ).not.toBeNull();
    act(() => {
      result.current.onRecheck();
    });
    expect(result.current.state).toBe('resuming');
    expect(harness.lookup).toHaveBeenCalledTimes(2);
  });

  it('discards on resume-404 and lands idle', async () => {
    const harness = createHarness();
    writeOxygenHandoffMarker(harness.storage, ORDER_A, NOW);
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness))
    );
    await resolveLookup(harness, 0, lookupErr(404));
    expect(result.current.state).toBe('idle');
    expect(harness.storage.getItem(oxygenHandoffMarkerKey(ORDER_A))).toBeNull();
  });

  it.each([
    ['expired', NOW - OXYGEN_HANDOFF_MARKER_TTL_MS - 1],
    ['mismatched', NOW],
  ])('treats an invalid (%s) marker as idle + discard with zero fetch', async (_label, createdAt) => {
    const harness = createHarness();
    const orderId = _label === 'mismatched' ? 'another-order' : ORDER_A;
    harness.storage.setItem(
      oxygenHandoffMarkerKey(ORDER_A),
      JSON.stringify({ orderId, createdAt })
    );
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness))
    );
    expect(result.current.state).toBe('idle');
    expect(harness.lookup).not.toHaveBeenCalled();
    expect(harness.storage.getItem(oxygenHandoffMarkerKey(ORDER_A))).toBeNull();
  });

  it('treats a corrupt marker as idle + discard with zero fetch', () => {
    const harness = createHarness();
    harness.storage.setItem(oxygenHandoffMarkerKey(ORDER_A), '{corrupt');
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness))
    );
    expect(result.current.state).toBe('idle');
    expect(harness.lookup).not.toHaveBeenCalled();
    expect(harness.storage.getItem(oxygenHandoffMarkerKey(ORDER_A))).toBeNull();
  });
});
