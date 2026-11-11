// @vitest-environment jsdom

// biome-ignore-all assist/source/organizeImports: auth-store-test-utils must be imported before @/stores/auth-store — its module-level vi.mock registrations have to run first, and import sorting would reorder them (breaks the suite with a raw-TS transform error).
import type { User } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createInitializingAuthState,
  createSession,
  deferred,
  getAuthStateChangeCallback,
  mocks,
} from './auth-store-test-utils';
import { useAuthStore } from '@/stores/auth-store';

describe('useAuthStore initialize', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState(createInitializingAuthState());
    mocks.getClaims.mockResolvedValue({ data: { claims: {} }, error: null });
    mocks.getSession.mockResolvedValue({
      data: { session: null },
      error: null,
    });
    mocks.getUser.mockResolvedValue({
      data: { user: null },
      error: null,
    });
    mocks.signOut.mockResolvedValue({ error: null });
    mocks.onAuthStateChange.mockImplementation(() => ({
      data: { subscription: { unsubscribe: vi.fn() } },
    }));
  });

  it('commits a persisted session from getSession before server validation resolves', async () => {
    const session = createSession();
    const serverValidation = deferred<{ data: { user: User }; error: null }>();
    mocks.getSession.mockResolvedValue({
      data: { session },
      error: null,
    });
    mocks.getUser.mockReturnValue(serverValidation.promise);

    const cleanup = useAuthStore.getState().initialize();

    await vi.waitFor(() => {
      expect(useAuthStore.getState()).toMatchObject({
        isAuthenticated: true,
        isInitialized: true,
        isLoading: false,
        session,
        user: session.user,
      });
    });
    expect(mocks.getSession).toHaveBeenCalled();

    cleanup();
    serverValidation.resolve({ data: { user: session.user }, error: null });
  });

  it('keeps a persisted session when background validation fails transiently', async () => {
    const session = createSession();
    mocks.getSession.mockResolvedValue({
      data: { session },
      error: null,
    });
    mocks.getClaims.mockResolvedValue({ data: null, error: null });
    mocks.getUser.mockRejectedValue(new TypeError('Network request failed'));

    const cleanup = useAuthStore.getState().initialize();

    await vi.waitFor(() => {
      expect(useAuthStore.getState()).toMatchObject({
        isAuthenticated: true,
        session,
        user: session.user,
      });
    });

    cleanup();
  });

  it('clears auth state when server-backed validation returns a terminal auth failure', async () => {
    const session = createSession();
    mocks.getSession.mockResolvedValue({
      data: { session },
      error: null,
    });
    mocks.getUser.mockResolvedValue({
      data: { user: null },
      error: { code: 'invalid_grant', message: 'Invalid refresh token' },
    });

    const cleanup = useAuthStore.getState().initialize();

    await vi.waitFor(() => {
      expect(useAuthStore.getState()).toMatchObject({
        isAuthenticated: false,
        session: null,
        user: null,
      });
    });

    await vi.waitFor(() => {
      expect(mocks.clearAdminQueryCache).toHaveBeenCalledTimes(1);
      expect(mocks.revenueCleanup).toHaveBeenCalledTimes(1);
      expect(mocks.resetSettings).toHaveBeenCalledTimes(1);
    });
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'local' });
    cleanup();
  });

  it('does not ignore INITIAL_SESSION auth events during startup', () => {
    const session = createSession();

    const cleanup = useAuthStore.getState().initialize();
    getAuthStateChangeCallback()('INITIAL_SESSION', session);

    expect(useAuthStore.getState()).toMatchObject({
      isAuthenticated: true,
      session,
      user: session.user,
    });
    cleanup();
  });

  it('ignores stale validation after a SIGNED_OUT event', async () => {
    const session = createSession('user-a');
    const validation = deferred<{ data: { user: User }; error: null }>();
    mocks.getSession.mockResolvedValue({ data: { session }, error: null });
    mocks.getUser.mockReturnValue(validation.promise);

    const cleanup = useAuthStore.getState().initialize();
    await vi.waitFor(() => {
      expect(useAuthStore.getState().isAuthenticated).toBe(true);
    });

    getAuthStateChangeCallback()('SIGNED_OUT', null);
    validation.resolve({ data: { user: session.user }, error: null });

    await vi.waitFor(() => {
      expect(useAuthStore.getState()).toMatchObject({
        isAuthenticated: false,
        session: null,
        user: null,
      });
    });
    cleanup();
  });

  it('does not let stale validation overwrite a newer refreshed token', async () => {
    const sessionA = createSession('user-a');
    const sessionB = {
      ...createSession('user-a'),
      access_token: 'access-token-user-a-refreshed',
      expires_at: 1_900_003_600,
    };
    const validation = deferred<{ data: { user: User }; error: null }>();
    mocks.getSession.mockResolvedValue({
      data: { session: sessionA },
      error: null,
    });
    mocks.getUser.mockReturnValue(validation.promise);

    const cleanup = useAuthStore.getState().initialize();
    await vi.waitFor(() => {
      expect(useAuthStore.getState().session).toBe(sessionA);
    });

    getAuthStateChangeCallback()('TOKEN_REFRESHED', sessionB);
    validation.resolve({ data: { user: sessionA.user }, error: null });

    await vi.waitFor(() => {
      expect(useAuthStore.getState().session).toBe(sessionB);
    });
    cleanup();
  });
});
