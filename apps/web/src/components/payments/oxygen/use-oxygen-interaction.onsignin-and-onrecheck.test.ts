import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  type UseOxygenInteractionOptions,
  useOxygenInteraction,
} from './use-oxygen-interaction';
import {
  createHarness,
  lookupErr,
  lookupOk,
  propsFor,
  resolveLookup,
  setupInteractionTests,
} from './use-oxygen-interaction.test-helpers';

setupInteractionTests();

describe('onSignin and onRecheck', () => {
  it('exposes a stable signin no-op (host owns navigation)', async () => {
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
    const first = result.current.onSignin;
    act(() => {
      result.current.onSignin();
    });
    expect(result.current.state).toBe('signin-required');
    expect(harness.lookup).toHaveBeenCalledTimes(1);
    expect(harness.submit).not.toHaveBeenCalled();
    rerender(propsFor(harness, { session: { status: 'guest' } }));
    expect(result.current.onSignin).toBe(first);
  });

  it('rechecks from unavailable and failed-with-recheck', async () => {
    const harness = createHarness();
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness))
    );
    await resolveLookup(harness, 0, lookupOk(false, 'oxygen_rollout_disabled'));
    act(() => {
      result.current.onRecheck();
    });
    expect(result.current.state).toBe('checking');
    expect(harness.lookup).toHaveBeenCalledTimes(2);
    await resolveLookup(harness, 1, lookupErr(500));
    act(() => {
      result.current.onRecheck();
    });
    expect(result.current.state).toBe('checking');
    expect(harness.lookup).toHaveBeenCalledTimes(3);
  });

  it('ignores recheck where it is not offered', async () => {
    const harness = createHarness();
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness))
    );
    act(() => {
      result.current.onRecheck();
    });
    expect(result.current.state).toBe('checking');
    expect(harness.lookup).toHaveBeenCalledTimes(1);
    await resolveLookup(harness, 0, lookupErr(400));
    act(() => {
      result.current.onRecheck();
    });
    expect(result.current.state).toBe('failed');
    expect(harness.lookup).toHaveBeenCalledTimes(1);
  });
});
