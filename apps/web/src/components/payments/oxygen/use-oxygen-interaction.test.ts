import { renderHook } from '@testing-library/react';
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
  lookupOk,
  NOW,
  ORDER_A,
  ORDER_B,
  propsFor,
  resolveLookup,
  setupInteractionTests,
} from './use-oxygen-interaction.test-helpers';

setupInteractionTests();

describe('mount and lookup-on-resolve', () => {
  it('stays idle with a null orderId: zero fetch, markers kept', () => {
    const harness = createHarness();
    writeOxygenHandoffMarker(harness.storage, ORDER_A, NOW);
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness, { orderId: null }))
    );
    expect(result.current.state).toBe('idle');
    expect(harness.lookup).not.toHaveBeenCalled();
    expect(harness.submit).not.toHaveBeenCalled();
    expect(harness.onSecureFormRequest).not.toHaveBeenCalled();
    expect(
      readOxygenHandoffMarker(harness.storage, ORDER_A, NOW)
    ).not.toBeNull();
  });

  it('waits out a loading session, then looks up on resolve', () => {
    const harness = createHarness();
    const { result, rerender } = renderHook(
      (props: UseOxygenInteractionOptions) => useOxygenInteraction(props),
      {
        initialProps: propsFor(harness, {
          session: { status: 'loading' },
        }),
      }
    );
    expect(result.current.state).toBe('idle');
    expect(harness.lookup).not.toHaveBeenCalled();

    rerender(propsFor(harness, { session: { status: 'authenticated' } }));
    expect(result.current.state).toBe('checking');
    expect(harness.lookup).toHaveBeenCalledTimes(1);
    expect(harness.lookup).toHaveBeenCalledWith(ORDER_A);
  });

  it('looks up immediately when mounted with a resolved session', () => {
    const harness = createHarness();
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness))
    );
    expect(result.current.state).toBe('checking');
    expect(harness.lookup).toHaveBeenCalledTimes(1);
  });

  it('treats an initial guest session as resolved (lookup, not sign-out)', () => {
    const harness = createHarness();
    writeOxygenHandoffMarker(harness.storage, ORDER_A, NOW - 1000);
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness, { session: { status: 'guest' } }))
    );
    // A marker is present, so the guest lookup resumes rather than checks.
    expect(result.current.state).toBe('resuming');
    expect(harness.lookup).toHaveBeenCalledTimes(1);
  });

  it('treats a first loading-to-guest resolve as resolve, without clearing', () => {
    const harness = createHarness();
    writeOxygenHandoffMarker(harness.storage, ORDER_A, NOW);
    writeOxygenHandoffMarker(harness.storage, ORDER_B, NOW);
    const { result, rerender } = renderHook(
      (props: UseOxygenInteractionOptions) => useOxygenInteraction(props),
      {
        initialProps: propsFor(harness, {
          session: { status: 'loading' },
        }),
      }
    );
    rerender(propsFor(harness, { session: { status: 'guest' } }));
    expect(result.current.state).toBe('resuming');
    expect(harness.lookup).toHaveBeenCalledTimes(1);
    expect(harness.storage.keys()).toHaveLength(2);
  });

  it('emits zero submit and zero handoff until an explicit action', async () => {
    const harness = createHarness();
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness))
    );
    await resolveLookup(harness, 0, lookupOk(true));
    expect(result.current.state).toBe('ready');
    expect(harness.submit).not.toHaveBeenCalled();
    expect(harness.onSecureFormRequest).not.toHaveBeenCalled();
  });

  it('does not refetch when re-rendered with unchanged inputs', () => {
    const harness = createHarness();
    const { rerender } = renderHook(
      (props: UseOxygenInteractionOptions) => useOxygenInteraction(props),
      { initialProps: propsFor(harness) }
    );
    rerender(propsFor(harness));
    rerender(propsFor(harness));
    expect(harness.lookup).toHaveBeenCalledTimes(1);
  });
});
