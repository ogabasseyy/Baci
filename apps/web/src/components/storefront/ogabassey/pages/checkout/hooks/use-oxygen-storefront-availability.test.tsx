import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useOxygenStorefrontAvailability } from './use-oxygen-storefront-availability';

describe('Oxygen storefront admission', () => {
  afterEach(() => vi.unstubAllGlobals());
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
