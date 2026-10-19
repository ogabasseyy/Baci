import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useCartHandoff } from './use-cart-handoff';

afterEach(() => vi.unstubAllGlobals());
it('clears the restored locator after a definitive preview failure', async () => {
  sessionStorage.setItem(
    'baci-cart-handoff-active',
    JSON.stringify({
      token: 'pairing-secret',
      handoffId: 'public-id',
      merchantSlug: 'shop',
    })
  );
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ code: 'not_found' }), { status: 404 })
      )
  );
  const { result } = renderHook(() =>
    useCartHandoff({ token: 'pairing-secret', handoffId: 'public-id' })
  );
  await waitFor(() => expect(result.current.loadError).toBeTruthy());
  expect(result.current.previewRetryable).toBe(false);
  expect(sessionStorage.getItem('baci-cart-handoff-active')).toBeNull();
});
