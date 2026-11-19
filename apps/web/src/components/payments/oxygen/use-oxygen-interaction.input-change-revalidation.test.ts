import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
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

describe('input-change revalidation', () => {
  it('checks when a null orderId becomes set', () => {
    const harness = createHarness();
    const { result, rerender } = renderHook(
      (props: UseOxygenInteractionOptions) => useOxygenInteraction(props),
      { initialProps: propsFor(harness, { orderId: null }) }
    );
    expect(result.current.state).toBe('idle');
    rerender(propsFor(harness, { orderId: ORDER_A }));
    expect(result.current.state).toBe('checking');
    expect(harness.lookup).toHaveBeenCalledTimes(1);
    expect(harness.lookup).toHaveBeenCalledWith(ORDER_A);
  });

  it('rechecks when the order changes from ready', async () => {
    const harness = createHarness();
    const { result, rerender } = renderHook(
      (props: UseOxygenInteractionOptions) => useOxygenInteraction(props),
      { initialProps: propsFor(harness) }
    );
    await resolveLookup(harness, 0, lookupOk(true));
    expect(result.current.state).toBe('ready');
    rerender(propsFor(harness, { orderId: ORDER_B }));
    expect(result.current.state).toBe('checking');
    expect(harness.lookup).toHaveBeenCalledTimes(2);
    expect(harness.lookup).toHaveBeenNthCalledWith(2, ORDER_B);
  });

  it('resumes when a session event hits handed-off with its marker present', async () => {
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
      result.current.notifySessionEvent();
    });
    expect(result.current.state).toBe('resuming');
    expect(harness.lookup).toHaveBeenCalledTimes(2);
  });

  it('keeps the marker on a resume 401', async () => {
    const harness = createHarness();
    writeOxygenHandoffMarker(harness.storage, ORDER_A, NOW);
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness))
    );
    await resolveLookup(harness, 0, lookupErr(401));
    expect(result.current.state).toBe('signin-required');
    expect(result.current.reason).toBeUndefined();
    expect(
      readOxygenHandoffMarker(harness.storage, ORDER_A, NOW)
    ).not.toBeNull();
  });

  it('idles with the marker kept when the order clears mid-POST', async () => {
    const harness = createHarness();
    const { result, rerender } = renderHook(
      (props: UseOxygenInteractionOptions) => useOxygenInteraction(props),
      { initialProps: propsFor(harness) }
    );
    await resolveLookup(harness, 0, lookupOk(true));
    writeOxygenHandoffMarker(harness.storage, ORDER_A, NOW);
    act(() => {
      result.current.onSubmit();
    });
    expect(result.current.state).toBe('initiating');
    rerender(propsFor(harness, { orderId: null }));
    expect(result.current.state).toBe('idle');
    expect(
      readOxygenHandoffMarker(harness.storage, ORDER_A, NOW)
    ).not.toBeNull();
    await resolveSubmit(harness, 0, { ok: true });
    expect(result.current.state).toBe('idle');
    expect(harness.submit).toHaveBeenCalledTimes(1);
    expect(harness.onSecureFormRequest).not.toHaveBeenCalled();
  });
});
