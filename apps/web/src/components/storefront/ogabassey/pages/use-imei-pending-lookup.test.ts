import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const pollImeiCheck = vi.hoisted(() => vi.fn());
vi.mock('./imei-checker-request', () => ({ pollImeiCheck }));

import { pendingImeiStorageKey } from './imei-pending-storage';
import { useImeiPendingLookup } from './use-imei-pending-lookup';

describe('useImeiPendingLookup', () => {
  beforeEach(() => {
    localStorage.clear();
    pollImeiCheck.mockReset();
  });

  it('persists, polls, and clears a completed lookup', async () => {
    pollImeiCheck.mockResolvedValue({
      kind: 'complete',
      result: { device: 'iPhone', imei: '490154203237518' },
    });
    const { result } = renderHook(() =>
      useImeiPendingLookup({
        customerId: 'customer-1',
        host: 'shop.example.com',
        merchantSlug: 'ogabassey',
      })
    );

    act(() => {
      result.current.start({
        lookupId: '11111111-1111-4111-8111-111111111111',
        pollAfterMs: 0,
        tier: 'blacklist',
        device: 'smartphone',
      });
    });

    const key = pendingImeiStorageKey(
      'shop.example.com',
      'customer-1',
      'ogabassey'
    );
    expect(localStorage.getItem(key)).toContain('lookupId');
    await waitFor(() => expect(result.current.terminal?.kind).toBe('complete'));
    expect(result.current.terminal).toMatchObject({
      lookupId: '11111111-1111-4111-8111-111111111111',
      device: 'smartphone',
    });
    expect(localStorage.getItem(key)).toBeNull();
    expect(result.current.pending).toBeNull();
  });

  it('restores a pending lookup for the same customer', async () => {
    const key = pendingImeiStorageKey(
      'shop.example.com',
      'customer-1',
      'ogabassey'
    );
    localStorage.setItem(
      key,
      JSON.stringify({
        createdAt: new Date().toISOString(),
        lookupId: '11111111-1111-4111-8111-111111111111',
        tier: 'blacklist',
      })
    );
    pollImeiCheck.mockResolvedValue({ kind: 'pending', pollAfterMs: 5000 });

    const { result } = renderHook(() =>
      useImeiPendingLookup({
        customerId: 'customer-1',
        host: 'shop.example.com',
        merchantSlug: 'ogabassey',
      })
    );

    await waitFor(() => expect(result.current.pending?.tier).toBe('blacklist'));
  });

  it('continues low-frequency polling for a stale restored lookup', async () => {
    vi.useFakeTimers();
    const key = pendingImeiStorageKey(
      'shop.example.com',
      'customer-1',
      'ogabassey'
    );
    localStorage.setItem(
      key,
      JSON.stringify({
        createdAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
        lookupId: '11111111-1111-4111-8111-111111111111',
        tier: 'blacklist',
      })
    );
    pollImeiCheck.mockResolvedValue({ kind: 'pending', pollAfterMs: 5000 });

    const { result } = renderHook(() =>
      useImeiPendingLookup({
        customerId: 'customer-1',
        host: 'shop.example.com',
        merchantSlug: 'ogabassey',
      })
    );
    await act(async () => undefined);
    expect(result.current.paused).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(pollImeiCheck).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      'ogabassey'
    );
    vi.useRealTimers();
  });

  it('preserves another merchant pending lookup on a shared host', async () => {
    vi.useFakeTimers();
    pollImeiCheck.mockResolvedValue({ kind: 'pending', pollAfterMs: 5000 });
    const merchantAKey = pendingImeiStorageKey(
      'usebaci.com',
      'customer-1',
      'merchant-a'
    );
    localStorage.setItem(
      merchantAKey,
      JSON.stringify({
        createdAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
        lookupId: '11111111-1111-4111-8111-111111111111',
        tier: 'blacklist',
      })
    );
    const { result, rerender } = renderHook(
      ({ merchantSlug }) =>
        useImeiPendingLookup({
          customerId: 'customer-1',
          host: 'usebaci.com',
          merchantSlug,
        }),
      { initialProps: { merchantSlug: 'merchant-a' } }
    );
    await act(async () => undefined);
    expect(result.current.paused).toBe(true);

    rerender({ merchantSlug: 'merchant-b' });
    await act(async () => undefined);

    expect(result.current.pending).toBeNull();
    expect(result.current.paused).toBe(false);
    expect(result.current.terminal).toBeNull();
    expect(localStorage.getItem(merchantAKey)).toContain('lookupId');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(pollImeiCheck).not.toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      'merchant-b'
    );
    vi.useRealTimers();
  });
});
