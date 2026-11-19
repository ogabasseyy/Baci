import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useOxygenStorefrontAvailability } from './use-oxygen-storefront-availability';

describe('Oxygen storefront admission', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('starts admission lookup while the same customer session is resolving', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ available: true }) });
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useOxygenStorefrontAvailability({ customerId: 'first', merchantId: 'merchant', revision: 1, authenticated: false, loading: true }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await waitFor(() => expect(result.current).toBe(true));
  });
  it('keeps a same-account selection during refresh but clears it on sign-out', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ available: true }) }));
    const initial = { customerId: 'first', merchantId: 'merchant', revision: 1, authenticated: true, loading: false };
    const { result, rerender } = renderHook((props) => useOxygenStorefrontAvailability(props), { initialProps: initial });
    await waitFor(() => expect(result.current).toBe(true));
    rerender({ ...initial, revision: 2, authenticated: false, loading: true });
    expect(result.current).toBe(true);
    rerender({ ...initial, revision: 2, authenticated: false, loading: false });
    expect(result.current).toBe(false);
  });
  it('clears the selection when a refreshed admission is denied', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ available: true }) }).mockResolvedValueOnce({ ok: true, json: async () => ({ available: false }) });
    vi.stubGlobal('fetch', fetchMock);
    const initial = { customerId: 'first', merchantId: 'merchant', revision: 1, authenticated: true, loading: false };
    const { result, rerender } = renderHook((props) => useOxygenStorefrontAvailability(props), { initialProps: initial });
    await waitFor(() => expect(result.current).toBe(true));
    rerender({ ...initial, revision: 2 });
    await waitFor(() => expect(result.current).toBe(false));
  });
  it('shows admission only for the current signed-in customer and merchant', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ available: true }) }));
    const { result, rerender } = renderHook(({ customerId, merchantId }) =>
      useOxygenStorefrontAvailability({ customerId, merchantId, revision: 1, authenticated: true }),
      { initialProps: { customerId: 'first', merchantId: 'merchant' } });
    await waitFor(() => expect(result.current).toBe(true));
    act(() => rerender({ customerId: 'second', merchantId: 'merchant' }));
    expect(result.current).toBe(false);
    await waitFor(() => expect(result.current).toBe(true));
  });
  it('fails closed for guests and failed lookups', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const { result } = renderHook(() => useOxygenStorefrontAvailability({ customerId: 'customer', merchantId: 'merchant', revision: 1, authenticated: true }));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(result.current).toBe(false);
  });
});
