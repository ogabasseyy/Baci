import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  type OxygenMarkerStorage,
  oxygenHandoffMarkerKey,
} from '@/lib/payments/oxygen/interaction';
import { useOxygenInteraction } from './use-oxygen-interaction';
import {
  createHarness,
  lookupOk,
  ORDER_A,
  propsFor,
  resolveLookup,
  resolveSubmit,
  setupInteractionTests,
  submitErr,
} from './use-oxygen-interaction.test-helpers';

setupInteractionTests();

describe('storage and nonce defaults', () => {
  it('hands off without a marker when storage is explicitly null', async () => {
    const harness = createHarness();
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness, { storage: null }))
    );
    await resolveLookup(harness, 0, lookupOk(true));
    act(() => {
      result.current.onSubmit();
    });
    await resolveSubmit(harness, 0, { ok: true });
    expect(result.current.state).toBe('handed-off');
    expect(harness.onSecureFormRequest).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.length).toBe(0);
  });

  it('hands off through throwing storage (quota) without crashing', async () => {
    const harness = createHarness();
    const throwing: OxygenMarkerStorage = {
      get length(): number {
        return 0;
      },
      key: () => null,
      getItem: () => null,
      setItem: () => {
        throw new Error('quota exceeded');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    };
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness, { storage: throwing }))
    );
    await resolveLookup(harness, 0, lookupOk(true));
    act(() => {
      result.current.onSubmit();
    });
    await resolveSubmit(harness, 0, { ok: true });
    expect(result.current.state).toBe('handed-off');
    expect(harness.onSecureFormRequest).toHaveBeenCalledTimes(1);
  });

  it('defaults to the tab store when storage is omitted', async () => {
    const harness = createHarness();
    const { storage: _ignored, ...withoutStorage } = propsFor(harness);
    expect(_ignored).toBeDefined();
    const { result } = renderHook(() => useOxygenInteraction(withoutStorage));
    await resolveLookup(harness, 0, lookupOk(true));
    act(() => {
      result.current.onSubmit();
    });
    await resolveSubmit(harness, 0, { ok: true });
    expect(
      window.sessionStorage.getItem(oxygenHandoffMarkerKey(ORDER_A))
    ).not.toBeNull();
  });

  it('defaults nonces to UUIDs, unique per intent', async () => {
    const harness = createHarness();
    const { generateNonce: _ignored, ...withoutNonce } = propsFor(harness);
    expect(_ignored).toBeDefined();
    const { result } = renderHook(() => useOxygenInteraction(withoutNonce));
    const uuidV4 =
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    await resolveLookup(harness, 0, lookupOk(true));
    act(() => {
      result.current.onSubmit();
    });
    await resolveSubmit(harness, 0, submitErr(503));
    act(() => {
      result.current.onSubmit();
    });
    const first = vi.mocked(harness.submit).mock.calls[0]?.[0]?.nonce;
    const second = vi.mocked(harness.submit).mock.calls[1]?.[0]?.nonce;
    expect(first).toMatch(uuidV4);
    expect(second).toMatch(uuidV4);
    expect(first).not.toBe(second);
  });
});
