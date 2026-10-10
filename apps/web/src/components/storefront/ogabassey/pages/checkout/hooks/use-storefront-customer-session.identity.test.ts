import { act, renderHook, waitFor } from '@testing-library/react';
import type { AuthChangeEvent } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useStorefrontCustomerSession } from './use-storefront-customer-session';

type AuthChangeHandler = (
  event: AuthChangeEvent,
  session?: { user?: { id?: string } | null } | null
) => void;

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

function emitAuthChange(
  event: AuthChangeEvent,
  session?: { user?: { id?: string } | null } | null
) {
  authChangeHandler?.(event, session);
}

function stubFetch(response: { body: unknown; ok?: boolean }) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: response.ok ?? true,
    json: async () => response.body,
  } as Response);
}

describe('useStorefrontCustomerSession revision and account identity', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    authChangeHandler = null;
    unsubscribe.mockClear();
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

  describe('accountId', () => {
    it('starts null, seeds from INITIAL_SESSION, and survives token refresh', async () => {
      stubFetch({ body: { authenticated: true } });

      const { result } = renderHook(() =>
        useStorefrontCustomerSession('test-store')
      );

      expect(result.current.accountId).toBeNull();
      act(() => {
        emitAuthChange('INITIAL_SESSION', { user: { id: 'user-1' } });
      });
      expect(result.current.accountId).toBe('user-1');
      act(() => {
        emitAuthChange('TOKEN_REFRESHED', { user: { id: 'user-1' } });
      });
      expect(result.current.accountId).toBe('user-1');
    });

    it('tracks account switches and clears on sign-out', async () => {
      stubFetch({ body: { authenticated: true } });

      const { result } = renderHook(() =>
        useStorefrontCustomerSession('test-store')
      );

      act(() => {
        emitAuthChange('INITIAL_SESSION', { user: { id: 'user-1' } });
      });
      act(() => {
        emitAuthChange('SIGNED_IN', { user: { id: 'user-2' } });
      });
      expect(result.current.accountId).toBe('user-2');
      act(() => {
        emitAuthChange('SIGNED_OUT', null);
      });
      expect(result.current.accountId).toBeNull();
    });
});
});
