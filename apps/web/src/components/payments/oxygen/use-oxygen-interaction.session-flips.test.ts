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

describe('session flips', () => {
  it('revalidates when the session flips to authenticated', async () => {
    const harness = createHarness();
    const { result, rerender } = renderHook(
      (props: UseOxygenInteractionOptions) => useOxygenInteraction(props),
      {
        initialProps: propsFor(harness, { session: { status: 'guest' } }),
      }
    );
    await resolveLookup(
      harness,
      0,
      lookupOk(false, 'oxygen_guest_not_allowed')
    );
    expect(result.current.state).toBe('signin-required');
    rerender(propsFor(harness, { session: { status: 'authenticated' } }));
    expect(result.current.state).toBe('checking');
    expect(harness.lookup).toHaveBeenCalledTimes(2);
  });

  it('resets to idle + prefix-clear on sign-out (authenticated to guest)', async () => {
    const harness = createHarness();
    const { result, rerender } = renderHook(
      (props: UseOxygenInteractionOptions) => useOxygenInteraction(props),
      { initialProps: propsFor(harness) }
    );
    await resolveLookup(harness, 0, lookupOk(true));
    expect(result.current.state).toBe('ready');
    writeOxygenHandoffMarker(harness.storage, ORDER_A, NOW);
    writeOxygenHandoffMarker(harness.storage, ORDER_B, NOW);
    harness.storage.setItem('unrelated-key', 'keep');
    rerender(propsFor(harness, { session: { status: 'guest' } }));
    expect(result.current.state).toBe('idle');
    expect(harness.storage.keys()).toEqual(['unrelated-key']);
    expect(harness.lookup).toHaveBeenCalledTimes(1);
  });

  it('treats authenticated-loading-guest as a sign-out (prefix-clear)', () => {
    const harness = createHarness();
    const { result, rerender } = renderHook(
      (props: UseOxygenInteractionOptions) => useOxygenInteraction(props),
      { initialProps: propsFor(harness) }
    );
    writeOxygenHandoffMarker(harness.storage, ORDER_A, NOW);
    rerender(propsFor(harness, { session: { status: 'loading' } }));
    expect(result.current.state).toBe('idle');
    rerender(propsFor(harness, { session: { status: 'guest' } }));
    expect(result.current.state).toBe('idle');
    expect(harness.storage.keys()).toEqual([]);
  });

  it('suspends ready actions when session revalidation starts', async () => {
    const harness = createHarness();
    const { result, rerender } = renderHook(
      (props: UseOxygenInteractionOptions) => useOxygenInteraction(props),
      { initialProps: propsFor(harness) }
    );
    await resolveLookup(harness, 0, lookupOk(true));
    rerender(propsFor(harness, { session: { status: 'loading' } }));
    expect(result.current.state).toBe('idle');
    act(() => result.current.onSubmit());
    expect(harness.submit).not.toHaveBeenCalled();
    expect(harness.lookup).toHaveBeenCalledTimes(1);
  });

  it('idles with markers kept when the order clears', async () => {
    const harness = createHarness();
    const { result, rerender } = renderHook(
      (props: UseOxygenInteractionOptions) => useOxygenInteraction(props),
      { initialProps: propsFor(harness) }
    );
    await resolveLookup(harness, 0, lookupOk(true));
    writeOxygenHandoffMarker(harness.storage, ORDER_A, NOW);
    rerender(propsFor(harness, { orderId: null }));
    expect(result.current.state).toBe('idle');
    expect(
      readOxygenHandoffMarker(harness.storage, ORDER_A, NOW)
    ).not.toBeNull();
  });

  it('drops a stale submit after sign-out mid-POST', async () => {
    const harness = createHarness();
    const { result, rerender } = renderHook(
      (props: UseOxygenInteractionOptions) => useOxygenInteraction(props),
      { initialProps: propsFor(harness) }
    );
    await resolveLookup(harness, 0, lookupOk(true));
    act(() => {
      result.current.onSubmit();
    });
    expect(result.current.state).toBe('initiating');
    rerender(propsFor(harness, { session: { status: 'guest' } }));
    expect(result.current.state).toBe('idle');
    await resolveSubmit(harness, 0, { ok: true });
    expect(result.current.state).toBe('idle');
    expect(harness.onSecureFormRequest).not.toHaveBeenCalled();
  });

  it('drops the late lookup after a guest-to-authenticated flip mid-lookup', async () => {
    const harness = createHarness();
    const { result, rerender } = renderHook(
      (props: UseOxygenInteractionOptions) => useOxygenInteraction(props),
      {
        initialProps: propsFor(harness, { session: { status: 'guest' } }),
      }
    );
    expect(result.current.state).toBe('checking');
    rerender(propsFor(harness, { session: { status: 'authenticated' } }));
    expect(result.current.state).toBe('checking');
    expect(harness.lookup).toHaveBeenCalledTimes(2);
    await resolveLookup(harness, 0, lookupOk(true));
    expect(result.current.state).toBe('checking');
    await resolveLookup(harness, 1, lookupOk(true));
    expect(result.current.state).toBe('ready');
  });
});
