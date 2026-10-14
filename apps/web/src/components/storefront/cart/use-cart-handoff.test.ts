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
