import type { User } from '@supabase/supabase-js';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from './auth-context';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getUser: vi.fn(),
  onAuthStateChange: vi.fn(),
  unsubscribe: vi.fn(),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: mocks.createClient,
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

describe('AuthProvider deferred boot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // A stored session takes the immediate boot path (same timing as the
    // pre-deferral behavior these cases pin down).
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

  it('reports signed-out without touching auth when the browser holds no session', async () => {
    window.localStorage.clear();
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });

    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>
    );

    expect(screen.getByText('user:none')).toBeInTheDocument();
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.getUser).not.toHaveBeenCalled();

    window.localStorage.setItem('sb-testref-auth-token', '{}');
  });

  it('boots auth on first interaction for session-less browsers', async () => {
    window.localStorage.clear();
    mocks.getUser.mockResolvedValue({
      data: { user: { id: 'user-3' } as User },
      error: null,
    });

    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>
    );

    expect(mocks.getUser).not.toHaveBeenCalled();

    window.dispatchEvent(new window.PointerEvent('pointerdown'));

    await waitFor(() => {
      expect(mocks.getUser).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(screen.getByText('user:user-3')).toBeInTheDocument();
    });

    window.localStorage.setItem('sb-testref-auth-token', '{}');
  });

  it('boots auth at the backstop even with no interaction', async () => {
    vi.useFakeTimers();
    // jsdom has no requestIdleCallback; stub a never-firing idle callback so
    // this pins the full 8s backstop of the idle-capable path.
    const requestIdleCallback = vi.fn(() => 1);
    Object.defineProperty(window, 'requestIdleCallback', {
      configurable: true,
      value: requestIdleCallback,
      writable: true,
    });
    try {
      window.localStorage.clear();
      mocks.getUser.mockResolvedValue({
        data: { user: { id: 'user-4' } as User },
        error: null,
      });

      render(
        <AuthProvider>
          <AuthProbe />
        </AuthProvider>
      );

      expect(mocks.getUser).not.toHaveBeenCalled();
      expect(requestIdleCallback).toHaveBeenCalledOnce();

      // The short no-idle-API fallback must not fire when the idle API exists.
      await vi.advanceTimersByTimeAsync(2000);
      expect(mocks.getUser).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(6000);
      vi.useRealTimers();

      await waitFor(() => {
        expect(mocks.getUser).toHaveBeenCalled();
      });
    } finally {
      vi.useRealTimers();
      Reflect.deleteProperty(window, 'requestIdleCallback');
      window.localStorage.setItem('sb-testref-auth-token', '{}');
    }
  });

  it('settles loading when the lazy client initialization rejects', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    mocks.createClient.mockImplementationOnce(() => {
      throw new Error('chunk failed');
    });

    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>
    );

    // Fails open to signed-out instead of stranding the page on loading.
    await waitFor(() => {
      expect(screen.getByText('loading:false')).toBeInTheDocument();
    });
    expect(screen.getByText('user:none')).toBeInTheDocument();
    consoleError.mockRestore();
  });

  it('boots immediately when the browser holds only chunked auth cookies', async () => {
    // @supabase/ssr splits large sessions into `sb-<ref>-auth-token.N`
    // cookies; a chunked-only browser must still take the immediate path.
    window.localStorage.clear();
    // biome-ignore lint/suspicious/noDocumentCookie: models a chunked-only browser.
    document.cookie = 'sb-testref-auth-token.0={}';
    mocks.getUser.mockResolvedValue({
      data: { user: { id: 'user-5' } as User },
      error: null,
    });

    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(mocks.getUser).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(screen.getByText('user:user-5')).toBeInTheDocument();
    });

    // biome-ignore lint/suspicious/noDocumentCookie: chunked-cookie cleanup.
    document.cookie =
      'sb-testref-auth-token.0=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
    window.localStorage.setItem('sb-testref-auth-token', '{}');
  });

  it('boots auth at the short fallback when requestIdleCallback is unavailable', async () => {
    // jsdom ships no requestIdleCallback, so this pins the RIC-less path
    // (older engines, embedded webviews) without stubbing.
    expect(window.requestIdleCallback).toBeUndefined();
    vi.useFakeTimers();
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

      expect(mocks.getUser).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1999);
      expect(mocks.getUser).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
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
});
