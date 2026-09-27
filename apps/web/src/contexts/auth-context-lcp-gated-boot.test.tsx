import type { User } from '@supabase/supabase-js';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from './auth-context';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getUser: vi.fn(),
  onAuthStateChange: vi.fn(),
  unsubscribe: vi.fn(),
  // The LCP settle mechanics are covered in wait-for-lcp.test.ts. Here it
  // pends or resolves per test so boot timing stays deterministic under
  // jsdom, which never emits LCP entries.
  waitForLcpWindowEnd: vi.fn(async () => undefined),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: mocks.createClient,
}));

vi.mock('@/lib/posthog/wait-for-lcp', () => ({
  waitForLcpWindowEnd: mocks.waitForLcpWindowEnd,
}));

function AuthProbe() {
  const { loading, user } = useAuth();

  return (
    <div>
      <span>loading:{String(loading)}</span>
      <span>user:{user?.id ?? 'none'}</span>
    </div>
  );
}

describe('AuthProvider LCP-gated boot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.setItem('sb-testref-auth-token', '{}');
    mocks.getUser.mockReturnValue(
      new Promise(() => {
        // Intentionally unresolved to verify initialUser is used immediately.
      })
    );
    mocks.onAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe: mocks.unsubscribe } },
    });
    mocks.createClient.mockReturnValue({
      auth: {
        getUser: mocks.getUser,
        onAuthStateChange: mocks.onAuthStateChange,
      },
    });
  });

  it('waits out the LCP window before booting on the short fallback', async () => {
    // The 2s RIC-less timer must not import the Supabase client while the
    // hero LCP is still pending — it starts the LCP wait instead. Boot
    // follows once LCP settles.
    expect(window.requestIdleCallback).toBeUndefined();
    vi.useFakeTimers();
    let resolveLcpWindow: () => void = () => undefined;
    mocks.waitForLcpWindowEnd.mockReturnValueOnce(
      new Promise<undefined>((resolve) => {
        resolveLcpWindow = () => resolve(undefined);
      })
    );
    try {
      window.localStorage.clear();
      mocks.getUser.mockResolvedValue({
        data: { user: null },
        error: null,
      });

      render(
        <AuthProvider>
          <AuthProbe />
        </AuthProvider>
      );

      await vi.advanceTimersByTimeAsync(2000);
      expect(mocks.waitForLcpWindowEnd).toHaveBeenCalledOnce();
      expect(mocks.getUser).not.toHaveBeenCalled();

      resolveLcpWindow();
      vi.useRealTimers();

      await waitFor(() => {
        expect(mocks.getUser).toHaveBeenCalled();
      });
      await waitFor(() => {
        expect(screen.getByText('loading:false')).toBeInTheDocument();
      });
    } finally {
      vi.useRealTimers();
      window.localStorage.setItem('sb-testref-auth-token', '{}');
    }
  });

  it('boots immediately on interaction even while the LCP window is pending', async () => {
    // Escape hatch: an engaged shopper outranks LCP protection, and the
    // still-pending LCP wait must not boot a second time when it settles.
    vi.useFakeTimers();
    let resolveLcpWindow: () => void = () => undefined;
    mocks.waitForLcpWindowEnd.mockReturnValueOnce(
      new Promise<undefined>((resolve) => {
        resolveLcpWindow = () => resolve(undefined);
      })
    );
    try {
      window.localStorage.clear();
      mocks.getUser.mockResolvedValue({
        data: { user: { id: 'user-6' } as User },
        error: null,
      });

      render(
        <AuthProvider>
          <AuthProbe />
        </AuthProvider>
      );

      await vi.advanceTimersByTimeAsync(2000);
      expect(mocks.getUser).not.toHaveBeenCalled();

      window.dispatchEvent(new window.PointerEvent('pointerdown'));
      vi.useRealTimers();

      await waitFor(() => {
        expect(mocks.getUser).toHaveBeenCalledOnce();
      });

      resolveLcpWindow();
      await waitFor(() => {
        expect(screen.getByText('user:user-6')).toBeInTheDocument();
      });
      // The settled LCP wait is a no-op: exactly one boot, one getUser.
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(mocks.getUser).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
      window.localStorage.setItem('sb-testref-auth-token', '{}');
    }
  });
});
