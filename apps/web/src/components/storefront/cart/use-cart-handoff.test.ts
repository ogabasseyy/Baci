import { renderHook, waitFor } from '@testing-library/react';
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
