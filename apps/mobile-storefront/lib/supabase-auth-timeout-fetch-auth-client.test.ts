import { jest } from '@jest/globals';
import { createClient, type Session } from '@supabase/supabase-js';
import { createSupabaseAuthTimeoutFetch } from './supabase-auth-timeout-fetch';

function accessToken(exp: number): string {
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
    exp,
    sub: 'user-a',
  })}.signature`;
}

function session(refreshToken: string, expired = false): Session {
  const expiresAt = Math.floor(Date.now() / 1000) + (expired ? -60 : 3_600);
  return {
    access_token: accessToken(expiresAt),
    expires_at: expiresAt,
    refresh_token: refreshToken,
    token_type: 'bearer',
    user: { id: 'user-a' },
  } as Session;
}

function storageFor(storedSession: Session) {
  return {
    getItem: jest.fn(async () => JSON.stringify(storedSession)),
    removeItem: jest.fn(async () => undefined),
    setItem: jest.fn(async () => undefined),
  };
}

describe('Supabase Auth client refresh boundaries', () => {
  let consoleErrorSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    jest.useRealTimers();
  });

  it('releases the shared refresh lock after background refresh transport failures', async () => {
    const storage = storageFor(session('refresh-token', true));
    const fetchImpl = jest
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('connection lost after commit'))
      .mockResolvedValueOnce(new Response(null, { status: 503 }));
    const client = createClient(
      'https://project.supabase.co',
      'publishable-key',
      {
        auth: {
          autoRefreshToken: true,
          detectSessionInUrl: false,
          persistSession: true,
          storage,
        },
        global: { fetch: createSupabaseAuthTimeoutFetch(fetchImpl, 100) },
      }
    );

    await expect(client.auth.getSession()).resolves.toBeDefined();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it('uses the explicitly supplied token without rotating stored auth first', async () => {
    const storage = storageFor(session('stored-refresh-token', true));
    const fetchImpl = jest.fn<typeof fetch>(async () =>
      Response.json({
        access_token: accessToken(Math.floor(Date.now() / 1000) + 3_600),
        expires_in: 3_600,
        refresh_token: 'rotated-refresh-token',
        token_type: 'bearer',
        user: { id: 'user-a' },
      })
    );
    const client = createClient(
      'https://project.supabase.co',
      'publishable-key',
      {
        auth: { autoRefreshToken: false, persistSession: true, storage },
        global: { fetch: fetchImpl },
      }
    );

    await expect(
      client.auth.refreshSession({ refresh_token: 'stored-refresh-token' })
    ).resolves.toMatchObject({ data: { session: expect.any(Object) } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('discards an explicit refresh after auth storage switches accounts', async () => {
    const storage = storageFor(session('account-b-refresh-token'));
    const fetchImpl = jest.fn<typeof fetch>();
    const client = createClient(
      'https://project.supabase.co',
      'publishable-key',
      {
        auth: { autoRefreshToken: false, persistSession: true, storage },
        global: { fetch: fetchImpl },
      }
    );

    const result = await client.auth.refreshSession({
      refresh_token: 'account-a-refresh-token',
      require_storage_match: true,
    });

    expect(result.error?.name).toBe('AuthRefreshDiscardedError');
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it.each([
    [
      'network rejection',
      () => Promise.reject(new TypeError('Network failed')),
    ],
    [
      '503 response',
      () => Promise.resolve(new Response(null, { status: 503 })),
    ],
  ])('does not internally retry an explicit checkout refresh after %s', async (_label, response) => {
    const storage = storageFor(session('stored-refresh-token'));
    const fetchImpl = jest.fn<typeof fetch>(response);
    const client = createClient(
      'https://project.supabase.co',
      'publishable-key',
      {
        auth: { autoRefreshToken: false, persistSession: true, storage },
        global: { fetch: fetchImpl },
      }
    );

    await expect(
      client.auth.refreshSession({
        refresh_token: 'stored-refresh-token',
        require_storage_match: true,
      })
    ).resolves.toMatchObject({
      data: { session: null },
      error: expect.anything(),
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('bypasses a transient refresh failure cache for an explicit checkout retry', async () => {
    const storage = storageFor(session('stored-refresh-token'));
    const fetchImpl = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(
        Response.json({
          access_token: accessToken(Math.floor(Date.now() / 1000) + 3_600),
          expires_in: 3_600,
          refresh_token: 'rotated-refresh-token',
          token_type: 'bearer',
          user: { id: 'user-a' },
        })
      );
    const client = createClient(
      'https://project.supabase.co',
      'publishable-key',
      {
        auth: { autoRefreshToken: false, persistSession: true, storage },
        global: { fetch: fetchImpl },
      }
    );

    await client.auth.refreshSession({
      refresh_token: 'stored-refresh-token',
      require_storage_match: true,
    });
    const retry = await client.auth.refreshSession({
      bypass_failure_cache: true,
      refresh_token: 'stored-refresh-token',
      require_storage_match: true,
    });

    expect(retry.data.session?.refresh_token).toBe('rotated-refresh-token');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
