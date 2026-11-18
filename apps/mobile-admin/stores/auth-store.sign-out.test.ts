// @vitest-environment jsdom

// biome-ignore-all assist/source/organizeImports: auth-store-test-utils must be imported before @/stores/auth-store — its module-level vi.mock registrations have to run first, and import sorting would reorder them (breaks the suite with a raw-TS transform error).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createSession,
  createSignedInAuthState,
  mocks,
} from './auth-store-test-utils';
import { useAuthStore } from '@/stores/auth-store';

describe('useAuthStore signOut', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState(createSignedInAuthState());
    mocks.getSession.mockResolvedValue({
      data: { session: null },
      error: null,
    });
    mocks.signOut.mockResolvedValue({ error: null });
  });

  it('uses local Supabase sign-out and clears app-local auth state', async () => {
    await useAuthStore.getState().signOut();

    expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(useAuthStore.getState()).toMatchObject({
      activeAuthProvider: null,
      isAuthenticated: false,
      isAuthenticating: false,
      isLoading: false,
      session: null,
      user: null,
    });
  });

  it('clears app-local auth state even when Supabase sign-out returns an expected auth error', async () => {
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    mocks.signOut.mockResolvedValue({
      error: {
        name: 'AuthSessionMissingError',
        message: 'Auth session missing',
      },
    });

    await useAuthStore.getState().signOut();

    expect(useAuthStore.getState()).toMatchObject({
      isAuthenticated: false,
      session: null,
      user: null,
    });
    expect(warnSpy).not.toHaveBeenCalled();
    expect(mocks.removeAuthStorageKeys).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('still signs out and clears local auth when resetting user stores fails', async () => {
    const resetError = new Error('reset failed');
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    mocks.revenueCleanup.mockImplementationOnce(() => {
      throw resetError;
    });

    await useAuthStore.getState().signOut();

    expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(useAuthStore.getState()).toMatchObject({
      isAuthenticated: false,
      session: null,
      user: null,
    });
    expect(warnSpy).toHaveBeenCalledWith(
      '[AuthStore] resetUserStores failed during sign-out',
      resetError
    );
    warnSpy.mockRestore();
  });

  it('removes only Supabase auth storage keys if sign-out fails and a session remains persisted', async () => {
    const session = createSession();
    mocks.signOut.mockResolvedValue({
      error: new TypeError('Network request failed'),
    });
    mocks.getSession.mockResolvedValue({
      data: { session },
      error: null,
    });

    await useAuthStore.getState().signOut();

    expect(mocks.removeAuthStorageKeys).toHaveBeenCalledTimes(1);
  });

  it('does not remove Supabase auth storage keys if sign-out fails after the persisted session is gone', async () => {
    mocks.signOut.mockResolvedValue({
      error: new TypeError('Network request failed'),
    });
    mocks.getSession.mockResolvedValue({
      data: { session: null },
      error: null,
    });

    await useAuthStore.getState().signOut();

    expect(mocks.removeAuthStorageKeys).not.toHaveBeenCalled();
  });
});
