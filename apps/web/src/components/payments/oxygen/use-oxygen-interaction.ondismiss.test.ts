import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
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
  resolveSubmit,
  setupInteractionTests,
} from './use-oxygen-interaction.test-helpers';

setupInteractionTests();

describe('onDismiss', () => {
  it('dismisses ready to idle + clear', async () => {
    const harness = createHarness();
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness))
    );
    await resolveLookup(harness, 0, lookupOk(true));
    writeOxygenHandoffMarker(harness.storage, ORDER_A, NOW);
    act(() => {
      result.current.onDismiss();
    });
    expect(result.current.state).toBe('idle');
    expect(harness.storage.getItem(oxygenHandoffMarkerKey(ORDER_A))).toBeNull();
  });

  it('dismisses handed-off to idle + clear (explicit abandon)', async () => {
    const harness = createHarness();
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness))
    );
    await resolveLookup(harness, 0, lookupOk(true));
    act(() => {
      result.current.onSubmit();
    });
    await resolveSubmit(harness, 0, { ok: true });
    expect(result.current.state).toBe('handed-off');
    act(() => {
      result.current.onDismiss();
    });
    expect(result.current.state).toBe('idle');
    expect(harness.storage.getItem(oxygenHandoffMarkerKey(ORDER_A))).toBeNull();
  });

  it('dismisses unavailable to idle + clear', async () => {
    const harness = createHarness();
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness))
    );
    writeOxygenHandoffMarker(harness.storage, ORDER_A, NOW);
    await resolveLookup(harness, 0, lookupOk(false, 'oxygen_rollout_disabled'));
    expect(result.current.state).toBe('unavailable');
    expect(
      readOxygenHandoffMarker(harness.storage, ORDER_A, NOW)
    ).not.toBeNull();
    act(() => {
      result.current.onDismiss();
    });
    expect(result.current.state).toBe('idle');
    expect(harness.storage.getItem(oxygenHandoffMarkerKey(ORDER_A))).toBeNull();
  });

  it('dismisses signin-required to idle + clear', async () => {
    const harness = createHarness();
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness))
    );
    writeOxygenHandoffMarker(harness.storage, ORDER_A, NOW);
    await resolveLookup(harness, 0, lookupErr(401));
    expect(result.current.state).toBe('signin-required');
    expect(
      readOxygenHandoffMarker(harness.storage, ORDER_A, NOW)
    ).not.toBeNull();
    act(() => {
      result.current.onDismiss();
    });
    expect(result.current.state).toBe('idle');
    expect(harness.storage.getItem(oxygenHandoffMarkerKey(ORDER_A))).toBeNull();
  });

  it('ignores dismiss while initiating (do-not-close window)', async () => {
    const harness = createHarness();
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness))
    );
    await resolveLookup(harness, 0, lookupOk(true));
    act(() => {
      result.current.onSubmit();
    });
    act(() => {
      result.current.onDismiss();
    });
    expect(result.current.state).toBe('initiating');
    await resolveSubmit(harness, 0, { ok: true });
    expect(result.current.state).toBe('handed-off');
    expect(harness.onSecureFormRequest).toHaveBeenCalledTimes(1);
  });

  it('ignores dismiss while idle without clearing markers', () => {
    const harness = createHarness();
    writeOxygenHandoffMarker(harness.storage, ORDER_A, NOW);
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness, { orderId: null }))
    );
    act(() => {
      result.current.onDismiss();
    });
    expect(result.current.state).toBe('idle');
    expect(
      readOxygenHandoffMarker(harness.storage, ORDER_A, NOW)
    ).not.toBeNull();
  });

  it('dismisses checking to idle + clear and drops the late lookup', async () => {
    const harness = createHarness();
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness))
    );
    writeOxygenHandoffMarker(harness.storage, ORDER_A, NOW);
    act(() => {
      result.current.onDismiss();
    });
    expect(result.current.state).toBe('idle');
    expect(harness.storage.getItem(oxygenHandoffMarkerKey(ORDER_A))).toBeNull();
    await resolveLookup(harness, 0, lookupOk(true));
    expect(result.current.state).toBe('idle');
  });

  it('dismisses resuming to idle + clear', async () => {
    const harness = createHarness();
    writeOxygenHandoffMarker(harness.storage, ORDER_A, NOW);
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness))
    );
    expect(result.current.state).toBe('resuming');
    act(() => {
      result.current.onDismiss();
    });
    expect(result.current.state).toBe('idle');
    expect(harness.storage.getItem(oxygenHandoffMarkerKey(ORDER_A))).toBeNull();
  });

  it('dismisses failed to idle + clear', async () => {
    const harness = createHarness();
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness))
    );
    await resolveLookup(harness, 0, lookupErr(500));
    writeOxygenHandoffMarker(harness.storage, ORDER_A, NOW);
    act(() => {
      result.current.onDismiss();
    });
    expect(result.current.state).toBe('idle');
    expect(harness.storage.getItem(oxygenHandoffMarkerKey(ORDER_A))).toBeNull();
  });
});
