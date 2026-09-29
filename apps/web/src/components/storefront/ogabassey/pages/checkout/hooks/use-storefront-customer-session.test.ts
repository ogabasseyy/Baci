import { act, renderHook, waitFor } from '@testing-library/react';
import type { AuthChangeEvent } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useStorefrontCustomerSession } from './use-storefront-customer-session';

type AuthChangeHandler = (event: AuthChangeEvent) => void;

// Captured `onAuthStateChange` handler so tests can emit the storefront login
// signal (Supabase auth transition) deterministically — no timers, no polling.
let authChangeHandler: AuthChangeHandler | null = null;
const unsubscribe = vi.fn();

vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(() => ({
    auth: {
      onAuthStateChange: (handler: AuthChangeHandler) => {
        authChangeHandler = handler;
        return { data: { subscription: { unsubscribe } } };
      },
    },
  })),
}));

function emitAuthChange(event: AuthChangeEvent) {
  authChangeHandler?.(event);
}

function stubFetch(response: { body: unknown; ok?: boolean }) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: response.ok ?? true,
    json: async () => response.body,
  } as Response);
}

describe('useStorefrontCustomerSession', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    authChangeHandler = null;
    unsubscribe.mockClear();
  });

  it('reports a signed-in customer when the session endpoint says authenticated', async () => {
    const fetchMock = stubFetch({ body: { authenticated: true } });

    const { result } = renderHook(() =>
      useStorefrontCustomerSession('test-store')
    );

    await waitFor(() => {
      expect(result.current.isAuthenticated).toBe(true);
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/storefront/auth/session?merchantSlug=test-store',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it('stays unauthenticated for a guest session', async () => {
    stubFetch({ body: { authenticated: false } });

    const { result } = renderHook(() =>
      useStorefrontCustomerSession('test-store')
    );

    // Give the effect a tick to resolve; the default and result are both false.
    await Promise.resolve();
    expect(result.current.isAuthenticated).toBe(false);
  });

  it('treats a non-OK response as unauthenticated without throwing', async () => {
    stubFetch({ body: {}, ok: false });

    const { result } = renderHook(() =>
      useStorefrontCustomerSession('test-store')
    );

    await Promise.resolve();
    expect(result.current.isAuthenticated).toBe(false);
  });

  it('does not fetch and stays unauthenticated without a merchant slug', () => {
    const fetchMock = stubFetch({ body: { authenticated: true } });

    const { result } = renderHook(() =>
      useStorefrontCustomerSession(undefined)
    );

    expect(result.current.isAuthenticated).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  describe('bugfix: bound the session request so a stall fails closed', () => {
    // A dropped connection can leave the fetch hanging rather than rejecting,
    // pinning the gate on `loading`. The fetch carries an `AbortSignal.timeout`
    // so a stall aborts and resolves to guest (fail-closed), never hanging.
    it('arms an AbortSignal.timeout on the session fetch', async () => {
      const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
      const fetchMock = stubFetch({ body: { authenticated: true } });

      renderHook(() => useStorefrontCustomerSession('test-store'));

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledTimes(1);
      });
      expect(timeoutSpy).toHaveBeenCalledWith(expect.any(Number));
      // A positive bound so the request cannot hang indefinitely.
      expect(timeoutSpy.mock.calls[0]?.[0]).toBeGreaterThan(0);
    });

    it('resolves to guest when the session fetch times out (aborts)', async () => {
      // Simulate what AbortSignal.timeout produces on a stalled connection.
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(
        new DOMException('The operation timed out.', 'TimeoutError')
      );

      const { result } = renderHook(() =>
        useStorefrontCustomerSession('test-store')
      );

      // Fail-closed: the awaited value settles to false rather than hanging.
      await expect(
        result.current.waitForResolvedAuthenticated()
      ).resolves.toBe(false);
      await waitFor(() => {
        expect(result.current.status).toBe('guest');
      });
    });
  });

  describe('bugfix: refresh auth state after mid-checkout login', () => {
    it('flips to authenticated when a sign-in auth signal arrives after a guest load', async () => {
      // Arrange: shopper arrives signed out — first session fetch says guest.
      const fetchMock = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ authenticated: false }),
        } as Response)
        // Act (below): after login the re-fetch reflects the signed-in cookie.
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ authenticated: true }),
        } as Response);

      const { result } = renderHook(() =>
        useStorefrontCustomerSession('test-store')
      );

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledTimes(1);
      });
      expect(result.current.isAuthenticated).toBe(false);

      // Act: the storefront emits the login signal (CheckoutAuthModal sign-in).
      act(() => {
        emitAuthChange('SIGNED_IN');
      });

      // Assert: the gate re-evaluates and reflects the new signed-in state.
      await waitFor(() => {
        expect(result.current.isAuthenticated).toBe(true);
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('advances the revision when an auth transition settles to the same status', async () => {
      const fetchMock = stubFetch({ body: { authenticated: true } });
      const { result } = renderHook(() =>
        useStorefrontCustomerSession('test-store')
      );

      await waitFor(() => {
        expect(result.current.status).toBe('authenticated');
      });
      const firstRevision = result.current.revision;

      act(() => {
        emitAuthChange('SIGNED_IN');
      });

      await waitFor(() => {
        expect(result.current.status).toBe('authenticated');
        expect(result.current.revision).toBeGreaterThan(firstRevision);
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('stays guest when the post-login refresh fails (fail-closed)', async () => {
      // Arrange: guest load succeeds, then the refresh fetch rejects.
      const fetchMock = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ authenticated: false }),
        } as Response)
        .mockRejectedValueOnce(new Error('network down'));

      const { result } = renderHook(() =>
        useStorefrontCustomerSession('test-store')
      );

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledTimes(1);
      });

      // Act: auth signal arrives but the refresh cannot confirm the session.
      act(() => {
        emitAuthChange('SIGNED_IN');
      });

      // Assert: a failed refresh keeps the customer on the guest (order-DVA) path.
      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledTimes(2);
      });
      expect(result.current.isAuthenticated).toBe(false);
    });

    it('ignores the INITIAL_SESSION replay to avoid a duplicate fetch', async () => {
      const fetchMock = stubFetch({ body: { authenticated: false } });

      renderHook(() => useStorefrontCustomerSession('test-store'));

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledTimes(1);
      });

      act(() => {
        emitAuthChange('INITIAL_SESSION');
      });

      // No extra request: the explicit mount load already covered it.
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('unsubscribes from the auth listener on unmount', () => {
      stubFetch({ body: { authenticated: false } });

      const { unmount } = renderHook(() =>
        useStorefrontCustomerSession('test-store')
      );

      unmount();
      expect(unsubscribe).toHaveBeenCalled();
    });
  });

  describe('bugfix: await session resolution before the DVA branch decision', () => {
    // A signed-in customer whose session fetch is still in flight must NOT be
    // treated as a guest: the initial state is a distinct `loading`, and the
    // checkout submit awaits `waitForResolvedAuthenticated` for the real value.
    function deferredSessionFetch() {
      let resolveSession: (body: { authenticated: boolean }) => void = () => {};
      vi.spyOn(globalThis, 'fetch').mockReturnValue(
        new Promise<Response>((resolve) => {
          resolveSession = (body) =>
            resolve({ ok: true, json: async () => body } as Response);
        })
      );
      return { resolveSession: (body: { authenticated: boolean }) => resolveSession(body) };
    }

    it('exposes a loading status while the fetch is in flight, not guest', async () => {
      const { resolveSession } = deferredSessionFetch();

      const { result } = renderHook(() =>
        useStorefrontCustomerSession('test-store')
      );

      expect(result.current.status).toBe('loading');
      expect(result.current.isAuthenticated).toBe(false);

      act(() => {
        resolveSession({ authenticated: true });
      });

      await waitFor(() => {
        expect(result.current.status).toBe('authenticated');
      });
    });

    it('resolves the awaited value to signed-in even when read during loading', async () => {
      const { resolveSession } = deferredSessionFetch();

      const { result } = renderHook(() =>
        useStorefrontCustomerSession('test-store')
      );

      // Simulate the checkout submit racing the still-loading session.
      const pending = result.current.waitForResolvedAuthenticated();
      expect(result.current.status).toBe('loading');

      act(() => {
        resolveSession({ authenticated: true });
      });

      await expect(pending).resolves.toBe(true);
    });

    it('resolves the awaited value to false (fail-closed) when the fetch rejects', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));

      const { result } = renderHook(() =>
        useStorefrontCustomerSession('test-store')
      );

      await expect(
        result.current.waitForResolvedAuthenticated()
      ).resolves.toBe(false);
    });
  });
});
