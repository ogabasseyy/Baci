import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  type UseOxygenInteractionOptions,
  useOxygenInteraction,
} from './use-oxygen-interaction';
import {
  createHarness,
  lookupOk,
  ORDER_B,
  propsFor,
  resolveLookup,
  resolveSubmit,
  setupInteractionTests,
} from './use-oxygen-interaction.test-helpers';

setupInteractionTests();

describe('handoff lifecycle regressions', () => {
  it('ignores submit success after unmount without writing a marker', async () => {
    const harness = createHarness();
    const { result, unmount } = renderHook(() =>
      useOxygenInteraction(propsFor(harness))
    );
    await resolveLookup(harness, 0, lookupOk(true));
    act(() => result.current.onSubmit());
    unmount();
    await resolveSubmit(harness, 0, { ok: true });
    expect(harness.handoffs).toEqual([]);
    expect(harness.storage.keys()).toEqual([]);
  });

  it('ignores pending success while loading and revalidates the new order', async () => {
    const harness = createHarness();
    const { result, rerender } = renderHook(
      (props: UseOxygenInteractionOptions) => useOxygenInteraction(props),
      { initialProps: propsFor(harness) }
    );
    await resolveLookup(harness, 0, lookupOk(true));
    act(() => result.current.onSubmit());
    rerender(propsFor(harness, { session: { status: 'loading' } }));
    await resolveSubmit(harness, 0, { ok: true });
    expect(harness.handoffs).toEqual([]);
    expect(harness.storage.keys()).toEqual([]);
    expect(result.current.state).toBe('idle');
    rerender(
      propsFor(harness, { orderId: ORDER_B, session: { status: 'loading' } })
    );
    expect(harness.lookup).toHaveBeenCalledTimes(1);
    rerender(propsFor(harness, { orderId: ORDER_B }));
    expect(harness.lookup).toHaveBeenLastCalledWith(ORDER_B);
    await resolveLookup(harness, 1, lookupOk(true));
    expect(result.current.state).toBe('ready');
  });
});
