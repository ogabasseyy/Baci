import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
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
  resolveSubmit,
  setupInteractionTests,
} from './use-oxygen-interaction.test-helpers';

setupInteractionTests();

describe('notifySessionEvent', () => {
  it('resets to idle + prefix-clear for a guest session', async () => {
    const harness = createHarness();
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness, { session: { status: 'guest' } }))
    );
    await resolveLookup(harness, 0, lookupOk(true));
    expect(result.current.state).toBe('ready');
    writeOxygenHandoffMarker(harness.storage, ORDER_A, NOW);
    writeOxygenHandoffMarker(harness.storage, ORDER_B, NOW);
    act(() => {
      result.current.notifySessionEvent();
    });
    expect(result.current.state).toBe('idle');
    expect(harness.storage.keys()).toEqual([]);
  });

  it('revalidates for an authenticated session', async () => {
    const harness = createHarness();
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness))
    );
    await resolveLookup(harness, 0, lookupErr(503));
    expect(result.current.state).toBe('failed');
    act(() => {
      result.current.notifySessionEvent();
    });
    expect(result.current.state).toBe('checking');
    expect(harness.lookup).toHaveBeenCalledTimes(2);
  });

  it('idles without fetching or clearing for a loading session', async () => {
    const harness = createHarness();
    const { result, rerender } = renderHook(
      (props: UseOxygenInteractionOptions) => useOxygenInteraction(props),
      { initialProps: propsFor(harness) }
    );
    await resolveLookup(harness, 0, lookupOk(true));
    writeOxygenHandoffMarker(harness.storage, ORDER_A, NOW);
    rerender(propsFor(harness, { session: { status: 'loading' } }));
    expect(result.current.state).toBe('idle');
    act(() => {
      result.current.notifySessionEvent();
    });
    expect(result.current.state).toBe('idle');
    expect(harness.lookup).toHaveBeenCalledTimes(1);
    expect(
      readOxygenHandoffMarker(harness.storage, ORDER_A, NOW)
    ).not.toBeNull();
  });

  it('is safe with a null orderId', () => {
    const harness = createHarness();
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness, { orderId: null }))
    );
    act(() => {
      result.current.notifySessionEvent();
    });
    expect(result.current.state).toBe('idle');
    expect(harness.lookup).not.toHaveBeenCalled();
  });

  it('abandons an in-flight POST when a session event hits initiating', async () => {
    const harness = createHarness();
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness))
    );
    await resolveLookup(harness, 0, lookupOk(true));
    act(() => {
      result.current.onSubmit();
    });
    expect(result.current.state).toBe('initiating');
    act(() => {
      result.current.notifySessionEvent();
    });
    expect(result.current.state).toBe('checking');
    expect(harness.lookup).toHaveBeenCalledTimes(2);
    await resolveSubmit(harness, 0, { ok: true });
    expect(result.current.state).toBe('checking');
    expect(harness.onSecureFormRequest).not.toHaveBeenCalled();
    expect(harness.storage.getItem(oxygenHandoffMarkerKey(ORDER_A))).toBeNull();
    await resolveLookup(harness, 1, lookupOk(true));
    expect(result.current.state).toBe('ready');
  });
});
