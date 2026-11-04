import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  oxygenHandoffMarkerKey,
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

describe('onSubmit guards and settle paths part 3', () => {
  it('exits initiating on order change mid-POST and drops the late response', async () => {
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
    rerender(propsFor(harness, { orderId: ORDER_B }));
    expect(result.current.state).toBe('checking');
    await resolveSubmit(harness, 0, { ok: true });
    expect(result.current.state).toBe('checking');
    expect(harness.onSecureFormRequest).not.toHaveBeenCalled();
    expect(harness.storage.getItem(oxygenHandoffMarkerKey(ORDER_A))).toBeNull();
    await resolveLookup(harness, 1, lookupOk(true));
    expect(result.current.state).toBe('ready');
    // The abandoned POST must not wedge later submits.
    act(() => {
      result.current.onSubmit();
    });
    expect(harness.submit).toHaveBeenCalledTimes(2);
  });

  it('revalidates to resuming when the new order carries a marker', async () => {
    const harness = createHarness();
    const { result, rerender } = renderHook(
      (props: UseOxygenInteractionOptions) => useOxygenInteraction(props),
      { initialProps: propsFor(harness) }
    );
    await resolveLookup(harness, 0, lookupOk(true));
    act(() => {
      result.current.onSubmit();
    });
    writeOxygenHandoffMarker(harness.storage, ORDER_B, NOW);
    rerender(propsFor(harness, { orderId: ORDER_B }));
    expect(result.current.state).toBe('resuming');
    expect(harness.lookup).toHaveBeenCalledTimes(2);
    expect(harness.lookup).toHaveBeenNthCalledWith(2, ORDER_B);
  });
});
