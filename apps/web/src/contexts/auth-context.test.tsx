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

describe('AuthProvider', () => {
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

  it('uses the server-authenticated user while client auth refreshes', () => {
    const initialUser = { id: 'user-1' } as User;

    render(
      <AuthProvider initialUser={initialUser}>
        <AuthProbe />
      </AuthProvider>
    );

    expect(screen.getByText('loading:false')).toBeInTheDocument();
    expect(screen.getByText('user:user-1')).toBeInTheDocument();
  });

  it('upgrades to the refreshed user when getUser resolves with a new identity', async () => {
    const initialUser = { id: 'user-1' } as User;
    mocks.getUser.mockResolvedValue({
      data: { user: { id: 'user-1-refreshed' } as User },
      error: null,
    });

    render(
      <AuthProvider initialUser={initialUser}>
        <AuthProbe />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('user:user-1-refreshed')).toBeInTheDocument();
    });
    expect(screen.getByText('loading:false')).toBeInTheDocument();
  });

  it('retains initialUser when getUser rejects so the UI stays signed in', async () => {
    const initialUser = { id: 'user-1' } as User;
    mocks.getUser.mockRejectedValue(new Error('Network error'));

    render(
      <AuthProvider initialUser={initialUser}>
        <AuthProbe />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('user:user-1')).toBeInTheDocument();
      expect(screen.getByText('loading:false')).toBeInTheDocument();
    });
  });

  it('starts in a loading state when no initialUser is provided', () => {
    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>
    );

    expect(screen.getByText('loading:true')).toBeInTheDocument();
    expect(screen.getByText('user:none')).toBeInTheDocument();
  });

  it('reflects user changes pushed by onAuthStateChange', async () => {
    let pushAuthEvent: ((event: string, session: unknown) => void) | null =
      null;
    mocks.onAuthStateChange.mockImplementation(
      (callback: (event: string, session: unknown) => void) => {
        pushAuthEvent = callback;
        return { data: { subscription: { unsubscribe: mocks.unsubscribe } } };
      }
    );

    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>
    );

    // The subscription attaches once the lazily imported client resolves.
    await waitFor(() => {
      expect(pushAuthEvent).not.toBeNull();
    });
    // Two-step cast because TS can't narrow `let` re-assigned inside the
    // mockImplementation callback above.
    const push = pushAuthEvent as unknown as (
      event: string,
      session: unknown
    ) => void;
    push('SIGNED_IN', { user: { id: 'user-2' } });

    await waitFor(() => {
      expect(screen.getByText('user:user-2')).toBeInTheDocument();
    });
  });
});
