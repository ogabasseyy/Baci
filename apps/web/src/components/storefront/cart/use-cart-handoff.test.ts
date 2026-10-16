import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useCartHandoff } from './use-cart-handoff';

afterEach(() => vi.unstubAllGlobals());
it('removes the pairing fragment even when preview retrieval fails', async () => {
  window.history.replaceState(null, '', '/cart/handoff#pairing-secret');
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
  const { result } = renderHook(() =>
    useCartHandoff({ token: 'pairing-secret', handoffId: 'public-id' })
  );
  expect(window.location.hash).toBe('');
  await waitFor(() => expect(result.current.loadError).toBeTruthy());
  expect(result.current.destChecked).toBe(false);
});
it('clears stale merge picks when redemption reports a version conflict', async () => {
  const snapshot = {
    cartId: 'incoming-cart',
    currency: 'NGN',
    estimatedTotals: false,
    expiresAt: '2099-01-01T00:00:00Z',
    lines: [],
    merchantId: 'merchant-1',
    state: 'active',
    subtotalMinor: 0,
    totalMinor: 0,
    version: 1,
  };
  const preview = () =>
    new Response(
      JSON.stringify({
        status: 'pending',
        merchant: { id: 'merchant-1', slug: 'shop' },
        snapshot,
        expiresAt: '2099-01-01T00:00:00Z',
      })
    );
  const destination = () =>
    new Response(
      JSON.stringify({ cart: { ...snapshot, cartId: 'dest-cart', version: 3 } })
    );
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(preview())
      .mockResolvedValueOnce(destination())
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 'version_conflict' }), {
          status: 409,
        })
      )
      .mockResolvedValueOnce(preview())
      .mockResolvedValueOnce(destination())
  );
  const { result } = renderHook(() =>
    useCartHandoff({ token: 'valid', handoffId: 'public' })
  );
  await waitFor(() => expect(result.current.destChecked).toBe(true));
  act(() => {
    result.current.setConflicts([
      { item: { productId: 'p1' }, existing: {}, incoming: {} },
    ]);
    result.current.setResolutions({ p1: 'incoming' });
  });
  await act(async () => {
    await result.current.act('keep_existing');
  });
  expect(result.current.conflicts).toEqual([]);
  expect(result.current.resolutions).toEqual({});
  expect(result.current.redeemError).toMatch(/changed/);
});

it.each([
  'expired_proof',
  'invalid_proof',
])('accepts an empty destination after %s so bootstrap can replace its proof', async (code) => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: 'pending',
            merchant: { id: 'm', slug: 'shop' },
            snapshot: null,
          })
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code }), { status: 401 })
      )
  );
  const { result } = renderHook(() =>
    useCartHandoff({ token: 'valid', handoffId: 'public' })
  );
  await waitFor(() => expect(result.current.destChecked).toBe(true));
  expect(result.current.destinationError).toBeNull();
});
