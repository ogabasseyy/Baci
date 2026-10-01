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

describe('Supabase Auth client checkout deadlines', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('shares the checkout deadline across storage and refresh transport delays', async () => {
    jest.useFakeTimers();
    const storedSession = session('stored-refresh-token');
    const storage = {
      getItem: jest
        .fn<() => Promise<string>>()
        .mockImplementationOnce(
          () =>
            new Promise<string>((resolve) => {
              setTimeout(() => resolve(JSON.stringify(storedSession)), 30);
            })
        )
        .mockResolvedValue(JSON.stringify(storedSession)),
      removeItem: jest.fn(async () => undefined),
      setItem: jest.fn(async () => undefined),
    };
    const fetchImpl = jest.fn<typeof fetch>(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true }
          );
        })
    );
    const client = createClient(
      'https://project.supabase.co',
      'publishable-key',
      {
        auth: { autoRefreshToken: false, persistSession: true, storage },
        global: { fetch: createSupabaseAuthTimeoutFetch(fetchImpl, 100) },
      }
    );

    const refresh = client.auth.refreshSession({
      bypass_failure_cache: true,
      refresh_token: 'stored-refresh-token',
      require_storage_match: true,
      storage_deadline_at: Date.now() + 100,
    });
    await jest.advanceTimersByTimeAsync(30);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(70);

    await expect(refresh).resolves.toMatchObject({
      data: { session: null },
      error: expect.anything(),
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('persists rotated credentials before deadline-bound PKCE cleanup', async () => {
    const storedSession = session('stored-refresh-token');
    const calls: string[] = [];
    let finishCleanup: (() => void) | undefined;
    const storage = {
      getItem: jest.fn(async (key: string) =>
        key.endsWith('-code-verifier')
          ? JSON.stringify('verifier')
          : JSON.stringify(storedSession)
      ),
      removeItem: jest.fn((key: string) => {
        calls.push(`remove:${key}`);
        return new Promise<void>((resolve) => {
          finishCleanup = resolve;
        });
      }),
      setItem: jest.fn(async (key: string, value: string) => {
        calls.push(`set:${key}`);
        expect(JSON.parse(value)).toMatchObject({
          refresh_token: 'rotated-refresh-token',
        });
      }),
    };
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

    const refresh = client.auth.refreshSession({
      bypass_failure_cache: true,
      refresh_token: 'stored-refresh-token',
      require_storage_match: true,
      storage_deadline_at: Date.now() + 100,
    });

    await new Promise((resolve) => setImmediate(resolve));

    expect(calls).toEqual([
      'set:sb-project-auth-token',
      'remove:sb-project-auth-token-code-verifier',
    ]);
    finishCleanup?.();
    await expect(refresh).resolves.toMatchObject({
      data: { session: expect.any(Object) },
      error: null,
    });
  });

  it('preserves a rotated session when the post-refresh storage read returns no session near the deadline', async () => {
    const storedSession = session('stored-refresh-token');
    let providerCommitted = false;
    const storage = {
      getItem: jest.fn(async () =>
        providerCommitted ? null : JSON.stringify(storedSession)
      ),
      removeItem: jest.fn(async () => undefined),
      setItem: jest.fn(async () => undefined),
    };
    const fetchImpl = jest.fn<typeof fetch>(async () => {
      providerCommitted = true;
      return Response.json({
        access_token: accessToken(Math.floor(Date.now() / 1000) + 3_600),
        expires_in: 3_600,
        refresh_token: 'rotated-refresh-token',
        token_type: 'bearer',
        user: { id: 'user-a' },
      });
    });
    const client = createClient(
      'https://project.supabase.co',
      'publishable-key',
      {
        auth: { autoRefreshToken: false, persistSession: true, storage },
        global: { fetch: fetchImpl },
      }
    );

    const result = await client.auth.refreshSession({
      bypass_failure_cache: true,
      refresh_token: 'stored-refresh-token',
      require_storage_match: true,
      storage_deadline_at: Date.now() + 100,
    });

    expect(result.error).toBeNull();
    expect(result.data.session?.refresh_token).toBe('rotated-refresh-token');
    expect(storage.setItem).toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalledWith(
      'sb-project-auth-token',
      expect.any(Number)
    );
  });

  it('uses the checkout deadline while removing an expired rejected session', async () => {
    jest.useFakeTimers();
    const storedSession = session('stored-refresh-token', true);
    const storage = {
      getItem: jest.fn(async () => JSON.stringify(storedSession)),
      removeItem: jest.fn(async () => undefined),
      setItem: jest.fn(async () => undefined),
    };
    const fetchImpl = jest.fn<typeof fetch>(
      () =>
        new Promise<Response>((resolve) => {
          setTimeout(
            () =>
              resolve(
                Response.json(
                  { code: 'refresh_token_not_found', message: 'Invalid token' },
                  { status: 400 }
                )
              ),
            80
          );
        })
    );
    const client = createClient(
      'https://project.supabase.co',
      'publishable-key',
      {
        auth: { autoRefreshToken: false, persistSession: true, storage },
        global: { fetch: createSupabaseAuthTimeoutFetch(fetchImpl, 100) },
      }
    );
    const deadline = Date.now() + 100;

    const refresh = client.auth.refreshSession({
      bypass_failure_cache: true,
      refresh_token: 'stored-refresh-token',
      require_storage_match: true,
      storage_deadline_at: deadline,
    });
    await jest.advanceTimersByTimeAsync(80);
    await refresh;

    expect(storage.removeItem).toHaveBeenCalledWith(
      expect.any(String),
      deadline
    );
  });
});
