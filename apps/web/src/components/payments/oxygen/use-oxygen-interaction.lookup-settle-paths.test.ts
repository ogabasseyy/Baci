import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  oxygenHandoffMarkerKey,
  readOxygenHandoffMarker,
  writeOxygenHandoffMarker,
} from '@/lib/payments/oxygen/interaction';
import {
  type UseOxygenInteractionOptions,
  useOxygenInteraction,
} from './use-oxygen-interaction';
import {
  createHarness,
  lookupErr,
  lookupOk,
  NOW,
  ORDER_A,
  ORDER_B,
  propsFor,
  resolveLookup,
  setupInteractionTests,
} from './use-oxygen-interaction.test-helpers';

setupInteractionTests();

describe('lookup settle paths', () => {
  it('resolves 200 available to ready', async () => {
    const harness = createHarness();
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness))
    );
    await resolveLookup(harness, 0, lookupOk(true));
    expect(result.current.state).toBe('ready');
    expect(result.current.reason).toBeUndefined();
    expect(result.current.recoveries).toEqual([]);
  });

  it('resolves a 200 deny to unavailable with the reason', async () => {
    const harness = createHarness();
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness))
    );
    await resolveLookup(harness, 0, lookupOk(false, 'oxygen_rollout_disabled'));
    expect(result.current.state).toBe('unavailable');
    expect(result.current.reason).toBe('oxygen_rollout_disabled');
  });

  it('resolves the guest deny to signin-required', async () => {
    const harness = createHarness();
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness, { session: { status: 'guest' } }))
    );
    await resolveLookup(
      harness,
      0,
      lookupOk(false, 'oxygen_guest_not_allowed')
    );
    expect(result.current.state).toBe('signin-required');
    expect(result.current.reason).toBe('oxygen_guest_not_allowed');
  });

  it('resolves 404 to idle and discards the order marker', async () => {
    const harness = createHarness();
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness))
    );
    // Another tab wrote a marker after the check started.
    writeOxygenHandoffMarker(harness.storage, ORDER_A, NOW);
    await resolveLookup(harness, 0, lookupErr(404));
    expect(result.current.state).toBe('idle');
    expect(harness.storage.getItem(oxygenHandoffMarkerKey(ORDER_A))).toBeNull();
  });

  it('resolves 401 to reason-less signin-required with the marker kept', async () => {
    const harness = createHarness();
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness))
    );
    writeOxygenHandoffMarker(harness.storage, ORDER_A, NOW);
    await resolveLookup(harness, 0, lookupErr(401));
    expect(result.current.state).toBe('signin-required');
    expect(result.current.reason).toBeUndefined();
    expect(
      readOxygenHandoffMarker(harness.storage, ORDER_A, NOW)
    ).not.toBeNull();
  });

  it('resolves 400 to failed-with-no-recovery and logs the host bug once', async () => {
    const harness = createHarness();
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness))
    );
    await resolveLookup(harness, 0, lookupErr(400));
    expect(result.current.state).toBe('failed');
    expect(result.current.recoveries).toEqual([]);
    expect(console.error).toHaveBeenCalledTimes(1);
    const logged = vi.mocked(console.error).mock.calls.flat().join(' ');
    expect(logged).not.toContain(ORDER_A);
  });

  it.each([
    429, 500, 503,
  ])('resolves %s to failed-with-recheck without logging', async (status) => {
    const harness = createHarness();
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness))
    );
    await resolveLookup(harness, 0, lookupErr(status));
    expect(result.current.state).toBe('failed');
    expect(result.current.recoveries).toEqual(['recheck']);
    expect(console.error).not.toHaveBeenCalled();
  });

  it('resolves a network rejection to failed-with-recheck', async () => {
    const harness = createHarness();
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness))
    );
    await act(async () => {
      harness.lookups[0]?.reject(new Error('network down'));
    });
    expect(result.current.state).toBe('failed');
    expect(result.current.recoveries).toEqual(['recheck']);
  });

  it('fails closed when lookup throws synchronously on mount', async () => {
    const harness = createHarness();
    harness.lookup.mockImplementationOnce(() => {
      throw new Error('host lookup blew up');
    });
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness))
    );
    await act(async () => {});
    expect(result.current.state).toBe('failed');
    expect(result.current.recoveries).toEqual(['recheck']);
    // The shell stays functional: recheck issues a fresh lookup.
    act(() => {
      result.current.onRecheck();
    });
    expect(result.current.state).toBe('checking');
    expect(harness.lookup).toHaveBeenCalledTimes(2);
    await resolveLookup(harness, 0, lookupOk(true));
    expect(result.current.state).toBe('ready');
  });

  it('drops a stale lookup response after an order change (observable)', async () => {
    const harness = createHarness();
    const { result, rerender } = renderHook(
      (props: UseOxygenInteractionOptions) => useOxygenInteraction(props),
      { initialProps: propsFor(harness) }
    );
    rerender(propsFor(harness, { orderId: ORDER_B }));
    expect(result.current.state).toBe('checking');
    expect(harness.lookup).toHaveBeenCalledTimes(2);
    // The ORDER_A response arrives late and must not apply.
    await resolveLookup(harness, 0, lookupOk(true));
    expect(result.current.state).toBe('checking');
    await resolveLookup(harness, 1, lookupOk(true));
    expect(result.current.state).toBe('ready');
  });
});
