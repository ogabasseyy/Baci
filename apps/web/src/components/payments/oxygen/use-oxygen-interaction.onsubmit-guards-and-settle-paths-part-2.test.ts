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
  lookupOk,
  NOW,
  ORDER_A,
  propsFor,
  resolveLookup,
  resolveSubmit,
  setupInteractionTests,
  submitErr,
} from './use-oxygen-interaction.test-helpers';

setupInteractionTests();

describe('onSubmit guards and settle paths part 2', () => {
  it('resolves a codeless 403 to failed-with-both, never unavailable', async () => {
    const harness = createHarness();
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness))
    );
    await resolveLookup(harness, 0, lookupOk(true));
    act(() => {
      result.current.onSubmit();
    });
    await resolveSubmit(harness, 0, submitErr(403));
    expect(result.current.state).toBe('failed');
    expect(result.current.recoveries).toEqual(['recheck', 'resubmit']);
  });

  it('never fires the handoff on 503 (Phase A dormant)', async () => {
    const harness = createHarness();
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness))
    );
    await resolveLookup(harness, 0, lookupOk(true));
    act(() => {
      result.current.onSubmit();
    });
    await resolveSubmit(harness, 0, submitErr(503));
    expect(result.current.state).toBe('failed');
    expect(result.current.recoveries).toEqual(['recheck', 'resubmit']);
    expect(harness.onSecureFormRequest).not.toHaveBeenCalled();
    expect(harness.storage.getItem(oxygenHandoffMarkerKey(ORDER_A))).toBeNull();
  });

  it('resolves submit 404 to idle + discard', async () => {
    const harness = createHarness();
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness))
    );
    await resolveLookup(harness, 0, lookupOk(true));
    writeOxygenHandoffMarker(harness.storage, ORDER_A, NOW);
    act(() => {
      result.current.onSubmit();
    });
    await resolveSubmit(harness, 0, submitErr(404));
    expect(result.current.state).toBe('idle');
    expect(harness.storage.getItem(oxygenHandoffMarkerKey(ORDER_A))).toBeNull();
  });

  it('resolves submit 401 to signin-required with the marker kept', async () => {
    const harness = createHarness();
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness))
    );
    await resolveLookup(harness, 0, lookupOk(true));
    writeOxygenHandoffMarker(harness.storage, ORDER_A, NOW);
    act(() => {
      result.current.onSubmit();
    });
    await resolveSubmit(harness, 0, submitErr(401));
    expect(result.current.state).toBe('signin-required');
    expect(
      readOxygenHandoffMarker(harness.storage, ORDER_A, NOW)
    ).not.toBeNull();
  });

  it('resolves submit 400 to failed-with-no-recovery and logs once', async () => {
    const harness = createHarness();
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness))
    );
    await resolveLookup(harness, 0, lookupOk(true));
    act(() => {
      result.current.onSubmit();
    });
    await resolveSubmit(harness, 0, submitErr(400));
    expect(result.current.state).toBe('failed');
    expect(result.current.recoveries).toEqual([]);
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it('resolves a submit rejection to failed-with-both', async () => {
    const harness = createHarness();
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness))
    );
    await resolveLookup(harness, 0, lookupOk(true));
    act(() => {
      result.current.onSubmit();
    });
    await act(async () => {
      harness.submits[0]?.reject(new Error('network down'));
    });
    expect(result.current.state).toBe('failed');
    expect(result.current.recoveries).toEqual(['recheck', 'resubmit']);
  });

  it('resubmits from failed-with-resubmit with a fresh nonce', async () => {
    const harness = createHarness();
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness))
    );
    await resolveLookup(harness, 0, lookupOk(true));
    act(() => {
      result.current.onSubmit();
    });
    await resolveSubmit(harness, 0, submitErr(503));
    act(() => {
      result.current.onSubmit();
    });
    expect(result.current.state).toBe('initiating');
    expect(harness.submit).toHaveBeenCalledTimes(2);
    expect(harness.submit).toHaveBeenNthCalledWith(2, {
      orderId: ORDER_A,
      nonce: 'nonce-2',
    });
  });

  it('hands off on the resubmit after a 503 (single fire, fresh nonce)', async () => {
    const harness = createHarness();
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness))
    );
    await resolveLookup(harness, 0, lookupOk(true));
    act(() => {
      result.current.onSubmit();
    });
    await resolveSubmit(harness, 0, submitErr(503));
    expect(result.current.state).toBe('failed');
    expect(harness.onSecureFormRequest).not.toHaveBeenCalled();
    act(() => {
      result.current.onSubmit();
    });
    await resolveSubmit(harness, 1, { ok: true });
    expect(result.current.state).toBe('handed-off');
    expect(harness.onSecureFormRequest).toHaveBeenCalledTimes(1);
    expect(harness.handoffs[0]).toEqual({
      orderId: ORDER_A,
      nonce: 'nonce-2',
      issuedAt: NOW,
    });
    expect(readOxygenHandoffMarker(harness.storage, ORDER_A, NOW)).toEqual({
      orderId: ORDER_A,
      createdAt: NOW,
    });
  });

  it('fails closed when generateNonce throws synchronously', async () => {
    const harness = createHarness();
    harness.generateNonce.mockImplementationOnce(() => {
      throw new Error('no entropy');
    });
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness))
    );
    await resolveLookup(harness, 0, lookupOk(true));
    act(() => {
      result.current.onSubmit();
    });
    expect(result.current.state).toBe('failed');
    expect(result.current.recoveries).toEqual(['recheck', 'resubmit']);
    expect(harness.submit).not.toHaveBeenCalled();
    // Submits are not wedged: the retry mints a fresh nonce and posts.
    act(() => {
      result.current.onSubmit();
    });
    expect(result.current.state).toBe('initiating');
    expect(harness.submit).toHaveBeenCalledTimes(1);
    expect(harness.submit).toHaveBeenCalledWith({
      orderId: ORDER_A,
      nonce: 'nonce-1',
    });
  });

  it('fails closed when submit throws synchronously', async () => {
    const harness = createHarness();
    harness.submit.mockImplementationOnce(() => {
      throw new Error('host submit blew up');
    });
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness))
    );
    await resolveLookup(harness, 0, lookupOk(true));
    act(() => {
      result.current.onSubmit();
    });
    await act(async () => {});
    expect(result.current.state).toBe('failed');
    expect(result.current.recoveries).toEqual(['recheck', 'resubmit']);
    // The shell stays functional: resubmit posts again and can hand off.
    act(() => {
      result.current.onSubmit();
    });
    expect(harness.submit).toHaveBeenCalledTimes(2);
    await resolveSubmit(harness, 0, { ok: true });
    expect(result.current.state).toBe('handed-off');
    expect(harness.onSecureFormRequest).toHaveBeenCalledTimes(1);
  });
});
