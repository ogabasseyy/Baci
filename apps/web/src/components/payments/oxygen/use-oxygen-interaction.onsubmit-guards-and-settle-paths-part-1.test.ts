import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  type OxygenSubmitResult,
  readOxygenHandoffMarker,
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
  submitErr,
} from './use-oxygen-interaction.test-helpers';

setupInteractionTests();

describe('onSubmit guards and settle paths part 1', () => {
  it('submits once per intent with a single fresh nonce', async () => {
    const harness = createHarness();
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness))
    );
    await resolveLookup(harness, 0, lookupOk(true));
    act(() => {
      result.current.onSubmit();
    });
    expect(result.current.state).toBe('initiating');
    expect(harness.submit).toHaveBeenCalledTimes(1);
    expect(harness.submit).toHaveBeenCalledWith({
      orderId: ORDER_A,
      nonce: 'nonce-1',
    });
    expect(harness.generateNonce).toHaveBeenCalledTimes(1);
  });

  it('ignores an in-flight repeat (double-click): one call, one nonce', async () => {
    const harness = createHarness();
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness))
    );
    await resolveLookup(harness, 0, lookupOk(true));
    act(() => {
      result.current.onSubmit();
      result.current.onSubmit();
    });
    act(() => {
      result.current.onSubmit();
    });
    expect(harness.submit).toHaveBeenCalledTimes(1);
    expect(harness.generateNonce).toHaveBeenCalledTimes(1);
    expect(harness.nonces).toEqual(['nonce-1']);
  });

  it('ignores submit where it is not offered', async () => {
    const harness = createHarness();
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness))
    );
    act(() => {
      result.current.onSubmit();
    });
    expect(harness.submit).not.toHaveBeenCalled();
    await resolveLookup(harness, 0, lookupOk(false, 'oxygen_rollout_disabled'));
    act(() => {
      result.current.onSubmit();
    });
    expect(harness.submit).not.toHaveBeenCalled();
    expect(harness.generateNonce).not.toHaveBeenCalled();
  });

  it('hands off on 2xx: marker written, then the secure-form callback fires once', async () => {
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
    expect(readOxygenHandoffMarker(harness.storage, ORDER_A, NOW)).toEqual({
      orderId: ORDER_A,
      createdAt: NOW,
    });
    expect(harness.onSecureFormRequest).toHaveBeenCalledTimes(1);
    expect(harness.handoffs[0]).toEqual({
      orderId: ORDER_A,
      nonce: 'nonce-1',
      issuedAt: NOW,
    });
    expect(Object.keys(harness.handoffs[0] ?? {}).sort()).toEqual([
      'issuedAt',
      'nonce',
      'orderId',
    ]);
  });

  it('writes the marker before the handoff callback fires', async () => {
    const harness = createHarness();
    let markerVisibleAtFire: unknown = 'unobserved';
    harness.onSecureFormRequest.mockImplementation(() => {
      markerVisibleAtFire = readOxygenHandoffMarker(
        harness.storage,
        ORDER_A,
        NOW
      );
    });
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness))
    );
    await resolveLookup(harness, 0, lookupOk(true));
    act(() => {
      result.current.onSubmit();
    });
    await resolveSubmit(harness, 0, { ok: true });
    expect(markerVisibleAtFire).toEqual({ orderId: ORDER_A, createdAt: NOW });
  });

  it('fails safely with recheck only when secure-form navigation throws', async () => {
    const harness = createHarness();
    harness.onSecureFormRequest.mockImplementation(() => {
      throw new Error('private navigation details');
    });
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness))
    );
    await resolveLookup(harness, 0, lookupOk(true));
    act(() => result.current.onSubmit());
    await resolveSubmit(harness, 0, { ok: true });
    expect(result.current.state).toBe('failed');
    expect(result.current.recoveries).toEqual(['recheck']);
    expect(harness.onSecureFormRequest).toHaveBeenCalledTimes(1);
    expect(
      readOxygenHandoffMarker(harness.storage, ORDER_A, NOW)
    ).not.toBeNull();
    expect(console.error).toHaveBeenCalledWith(
      '[oxygen] secure-form handoff failed'
    );
    act(() => result.current.onSubmit());
    expect(harness.submit).toHaveBeenCalledTimes(1);
    act(() => result.current.onRecheck());
    expect(result.current.state).toBe('resuming');
    expect(harness.lookup).toHaveBeenCalledTimes(2);
  });

  it('ignores 2xx payload fields: no server ids enter the handoff', async () => {
    const harness = createHarness();
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness))
    );
    await resolveLookup(harness, 0, lookupOk(true));
    act(() => {
      result.current.onSubmit();
    });
    await resolveSubmit(harness, 0, {
      ok: true,
      attemptId: 'att_should_never_echo',
    } as unknown as OxygenSubmitResult);
    expect(result.current.state).toBe('handed-off');
    expect(JSON.stringify(harness.handoffs[0])).not.toContain(
      'att_should_never_echo'
    );
  });

  it('fires the handoff exactly once across re-renders', async () => {
    const harness = createHarness();
    const { result, rerender } = renderHook(
      (props: UseOxygenInteractionOptions) => useOxygenInteraction(props),
      { initialProps: propsFor(harness) }
    );
    await resolveLookup(harness, 0, lookupOk(true));
    act(() => {
      result.current.onSubmit();
    });
    await resolveSubmit(harness, 0, { ok: true });
    rerender(propsFor(harness));
    rerender(propsFor(harness));
    expect(harness.onSecureFormRequest).toHaveBeenCalledTimes(1);
  });

  it('fires again for a later successful submit (once per submit, not once ever)', async () => {
    const harness = createHarness();
    const { result, rerender } = renderHook(
      (props: UseOxygenInteractionOptions) => useOxygenInteraction(props),
      { initialProps: propsFor(harness) }
    );
    await resolveLookup(harness, 0, lookupOk(true));
    act(() => {
      result.current.onSubmit();
    });
    await resolveSubmit(harness, 0, { ok: true });
    rerender(propsFor(harness, { orderId: ORDER_B }));
    await resolveLookup(harness, 1, lookupOk(true));
    act(() => {
      result.current.onSubmit();
    });
    await resolveSubmit(harness, 1, { ok: true });
    expect(harness.onSecureFormRequest).toHaveBeenCalledTimes(2);
    expect(harness.handoffs[1]).toEqual({
      orderId: ORDER_B,
      nonce: 'nonce-2',
      issuedAt: NOW,
    });
  });

  it('resolves a coded 403 to unavailable with the reason', async () => {
    const harness = createHarness();
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness))
    );
    await resolveLookup(harness, 0, lookupOk(true));
    act(() => {
      result.current.onSubmit();
    });
    await resolveSubmit(harness, 0, submitErr(403, 'oxygen_not_configured'));
    expect(result.current.state).toBe('unavailable');
    expect(result.current.reason).toBe('oxygen_not_configured');
    expect(harness.onSecureFormRequest).not.toHaveBeenCalled();
  });
});
