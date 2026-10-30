import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRuntimeImeiAvailability } from './create-runtime-availability';
import type { fetchRuntimeImeiTierKeys } from './runtime-availability';
import type { ImeiServiceTierKey } from './service-tiers';

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

describe('shared IMEI availability lifecycle', () => {
  afterEach(() => vi.useRealTimers());

  it('publishes explicit empty availability and notifies subscribers', async () => {
    const fetchTierKeys = vi
      .fn<typeof fetchRuntimeImeiTierKeys>()
      .mockResolvedValue([]);
    const store = createRuntimeImeiAvailability({
      fetchTierKeys,
      apiBaseUrl: 'https://example.com',
    });
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    const cleanup = store.load('smartphone');
    await settle();
    expect(store.getView('smartphone', store.getSnapshot())).toMatchObject({
      availableTierKeys: [],
      failed: false,
      loading: false,
    });
    expect(fetchTierKeys).toHaveBeenCalledWith(
      expect.objectContaining({
        apiBaseUrl: 'https://example.com',
        device: 'smartphone',
      })
    );
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    cleanup();
  });

  it('aborts on timeout, retries and cancels the retry on unmount', async () => {
    vi.useFakeTimers();
    const fetchTierKeys = vi
      .fn<typeof fetchRuntimeImeiTierKeys>()
      .mockImplementation(() => new Promise(() => {}));
    const store = createRuntimeImeiAvailability({ fetchTierKeys });
    const cleanup = store.load('smartphone');
    await settle();
    await vi.advanceTimersByTimeAsync(8000);
    expect(store.getSnapshot()).toMatchObject({
      failed: true,
      loading: false,
      availableTierKeys: null,
    });
    expect(fetchTierKeys.mock.calls[0][0].signal?.aborted).toBe(true);
    store.getView('smartphone', store.getSnapshot()).retry();
    await settle();
    expect(store.getSnapshot().loading).toBe(true);
    cleanup();
    expect(fetchTierKeys.mock.calls[1][0].signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('masks the previous device immediately and ignores stale resolutions', async () => {
    let resolvePhone: (keys: ImeiServiceTierKey[]) => void = () => undefined;
    const fetchTierKeys = vi
      .fn<typeof fetchRuntimeImeiTierKeys>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolvePhone = resolve;
          })
      )
      .mockResolvedValueOnce([]);
    const store = createRuntimeImeiAvailability({ fetchTierKeys });
    store.load('smartphone');
    await settle();
    expect(store.getView('tablet', store.getSnapshot())).toMatchObject({
      availableTierKeys: null,
      loading: true,
      failed: false,
    });
    const cleanup = store.load('tablet');
    await settle();
    resolvePhone(['esimCompatibility']);
    await settle();
    expect(store.getSnapshot()).toMatchObject({
      device: 'tablet',
      availableTierKeys: [],
      loading: false,
    });
    cleanup();
  });

  it('handles synchronous transport errors without leaving loading stuck', async () => {
    const store = createRuntimeImeiAvailability({
      fetchTierKeys: () => {
        throw new Error('transport unavailable');
      },
    });
    const cleanup = store.load('smartphone');
    await settle();
    expect(store.getSnapshot()).toMatchObject({ failed: true, loading: false });
    cleanup();
  });
});
