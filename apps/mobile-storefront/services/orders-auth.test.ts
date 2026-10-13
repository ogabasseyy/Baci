import { jest } from '@jest/globals';
import { AuthRefreshDiscardedError, type Session } from '@supabase/supabase-js';

const mockWarn = jest.fn();

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ warn: mockWarn }),
}));

const { resolveCheckoutAuth } =
  require('./orders-auth') as typeof import('./orders-auth');

function session(accessToken: string): Session {
  return {
    access_token: accessToken,
    refresh_token: 'refresh-token',
    user: { id: 'user-a' },
  } as Session;
}

describe('resolveCheckoutAuth', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('keeps guest checkout unauthenticated without attempting a refresh', async () => {
    const auth = {
      refreshSession: jest.fn(async () => ({
        data: { session: session('unexpected-token') },
        error: null,
      })),
    };

    await expect(resolveCheckoutAuth(auth, null)).resolves.toEqual({
      authorizationHeaders: {},
      canValidateUser: false,
      session: null,
    });
    expect(auth.refreshSession).not.toHaveBeenCalled();
  });

  it('returns a refreshed session minted by the active signing key', async () => {
    const refreshedSession = session('active-signing-key-token');
    const auth = {
      refreshSession: jest.fn(async () => ({
        data: { session: refreshedSession },
        error: null,
      })),
    };

    await expect(
      resolveCheckoutAuth(auth, session('stale-signing-key-token'))
    ).resolves.toEqual({
      authorizationHeaders: {
        Authorization: 'Bearer active-signing-key-token',
      },
      canValidateUser: true,
      session: refreshedSession,
    });
    expect(mockWarn).not.toHaveBeenCalled();
    expect(auth.refreshSession).toHaveBeenCalledWith({
      bypass_failure_cache: true,
      refresh_token: 'refresh-token',
      require_storage_match: true,
      storage_deadline_at: expect.any(Number),
    });
  });

  it('omits stale authorization when refresh resolves with an error', async () => {
    const storedSession = session('stored-token');
    const auth = {
      refreshSession: jest.fn(async () => ({
        data: { session: null },
        error: new Error('Refresh rejected'),
      })),
    };

    const result = await resolveCheckoutAuth(auth, storedSession);

    expect(result.session).toBeNull();
    expect(result.canValidateUser).toBe(false);
    expect(mockWarn).toHaveBeenCalledWith(
      'Unable to refresh checkout session; omitting authorization',
      { error: 'Refresh rejected' }
    );
    expect(result.authorizationHeaders).toEqual({});
  });

  it('does not reuse the stored session when a concurrent auth change discards the refresh', async () => {
    const auth = {
      refreshSession: jest.fn(async () => ({
        data: { session: null },
        error: new AuthRefreshDiscardedError(),
      })),
    };

    await expect(
      resolveCheckoutAuth(auth, session('previous-account-token'))
    ).resolves.toEqual({
      authorizationHeaders: {},
      canValidateUser: false,
      session: null,
    });
    expect(mockWarn).toHaveBeenCalledWith(
      'Checkout session refresh was discarded; omitting stale session'
    );
  });

  it('uses a rotated current session when auto-refresh kept the same account', async () => {
    const currentSession = {
      ...session('rotated-access-token'),
      refresh_token: 'rotated-refresh-token',
    } as Session;
    const auth = {
      refreshSession: jest.fn(async () => ({
        data: { session: null },
        error: new AuthRefreshDiscardedError(),
      })),
    };

    await expect(
      resolveCheckoutAuth(
        auth,
        session('captured-access-token'),
        undefined,
        async () => currentSession
      )
    ).resolves.toEqual({
      authorizationHeaders: {
        Authorization: 'Bearer rotated-access-token',
      },
      canValidateUser: true,
      session: currentSession,
    });
    expect(mockWarn).toHaveBeenCalledWith(
      'Checkout session rotated during refresh; using the current session'
    );
  });

  it('does not treat an unchanged current session as a successful rotation', async () => {
    const storedSession = session('captured-access-token');
    const auth = {
      refreshSession: jest.fn(async () => ({
        data: { session: null },
        error: new AuthRefreshDiscardedError(),
      })),
    };

    await expect(
      resolveCheckoutAuth(
        auth,
        storedSession,
        undefined,
        async () => storedSession
      )
    ).resolves.toEqual({
      authorizationHeaders: {},
      canValidateUser: false,
      session: null,
    });
    expect(mockWarn).toHaveBeenCalledWith(
      'Checkout session refresh was discarded; omitting stale session'
    );
  });

  it('omits authorization when the refreshed session belongs to another account', async () => {
    const refreshedSession = {
      ...session('user-b-token'),
      user: { id: 'user-b' },
    } as Session;
    const auth = {
      refreshSession: jest.fn(async () => ({
        data: { session: refreshedSession },
        error: null,
      })),
    };

    await expect(
      resolveCheckoutAuth(auth, session('user-a-token'))
    ).resolves.toEqual({
      authorizationHeaders: {},
      canValidateUser: false,
      session: null,
    });
    expect(mockWarn).toHaveBeenCalledWith(
      'Checkout session identity changed during refresh; omitting authorization'
    );
  });

  it('omits stale authorization when refresh resolves without a session', async () => {
    const storedSession = session('stored-token');
    const auth = {
      refreshSession: jest.fn(async () => ({
        data: { session: null },
        error: null,
      })),
    };

    await expect(resolveCheckoutAuth(auth, storedSession)).resolves.toEqual({
      authorizationHeaders: {},
      canValidateUser: false,
      session: null,
    });
    expect(mockWarn).toHaveBeenCalledWith(
      'Unable to refresh checkout session; omitting authorization',
      { error: 'Refresh returned no session' }
    );
  });

  it('omits stale authorization when refresh rejects', async () => {
    const storedSession = session('stored-token');
    const auth = {
      refreshSession: jest.fn(async () => {
        throw new Error('Auth refresh unavailable');
      }),
    };

    await expect(resolveCheckoutAuth(auth, storedSession)).resolves.toEqual({
      authorizationHeaders: {},
      canValidateUser: false,
      session: null,
    });
    expect(mockWarn).toHaveBeenCalledWith(
      'Unable to refresh checkout session; omitting authorization',
      { error: 'Auth refresh unavailable' }
    );
  });

  it('bounds a pending refresh without reusing stale authorization', async () => {
    jest.useFakeTimers();
    const storedSession = session('stored-token');
    const auth = {
      refreshSession: jest.fn(() => new Promise<never>(() => undefined)),
    };
    const result = resolveCheckoutAuth(auth, storedSession, 100);

    await jest.advanceTimersByTimeAsync(100);

    await expect(result).resolves.toEqual({
      authorizationHeaders: {},
      canValidateUser: false,
      session: null,
    });
    expect(mockWarn).toHaveBeenCalledWith(
      'Unable to refresh checkout session; omitting authorization',
      { error: 'Checkout session refresh timed out' }
    );
  });

  it('waits for a delayed transport recovery within the checkout deadline', async () => {
    jest.useFakeTimers();
    const recoveredSession = session('recovered-token');
    const auth = {
      refreshSession: jest.fn(
        () =>
          new Promise<{ data: { session: Session }; error: null }>(
            (resolve) => {
              setTimeout(
                () =>
                  resolve({ data: { session: recoveredSession }, error: null }),
                7_000
              );
            }
          )
      ),
    };
    const result = resolveCheckoutAuth(auth, session('stored-token'));

    await jest.advanceTimersByTimeAsync(7_000);

    await expect(result).resolves.toMatchObject({
      authorizationHeaders: { Authorization: 'Bearer recovered-token' },
      canValidateUser: true,
      session: recoveredSession,
    });
  });
});
