import { jest } from '@jest/globals';
import { createClient, type Session } from '@supabase/supabase-js';

function accessToken(userId: string): string {
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
    exp: Math.floor(Date.now() / 1000) + 3_600,
    sub: userId,
  })}.signature`;
}

function session(userId: string, refreshToken: string): Session {
  return {
    access_token: accessToken(userId),
    expires_at: Math.floor(Date.now() / 1000) + 3_600,
    refresh_token: refreshToken,
    token_type: 'bearer',
    user: { id: userId },
  } as Session;
}

type SaveSessionAuth = {
  _saveSession(value: Session): Promise<void>;
};

describe('Supabase Auth session commit guard', () => {
  it('discards rotated account A credentials when account B was saved before a failed post-refresh read', async () => {
    const accountA = session('user-a', 'refresh-a');
    const accountB = session('user-b', 'refresh-b');
    let stored = JSON.stringify(accountA);
    let failPostRefreshRead = false;
    let finishProviderRefresh: ((response: Response) => void) | undefined;
    const storage = {
      getItem: jest.fn(async (key: string) => {
        if (key.endsWith('-code-verifier')) return null;
        if (failPostRefreshRead) {
          failPostRefreshRead = false;
          return null;
        }
        return stored;
      }),
      removeItem: jest.fn(async () => undefined),
      setItem: jest.fn(async (key: string, value: string) => {
        if (!key.endsWith('-code-verifier')) stored = value;
      }),
    };
    const fetchImpl = jest.fn<typeof fetch>(
      () =>
        new Promise<Response>((resolve) => {
          finishProviderRefresh = resolve;
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
      refresh_token: 'refresh-a',
      require_storage_match: true,
    });
    await new Promise((resolve) => setImmediate(resolve));
    await (client.auth as unknown as SaveSessionAuth)._saveSession(accountB);
    failPostRefreshRead = true;
    finishProviderRefresh?.(
      Response.json({
        ...session('user-a', 'rotated-a'),
        expires_in: 3_600,
      })
    );

    const result = await refresh;

    expect(result.error?.name).toBe('AuthRefreshDiscardedError');
    expect(JSON.parse(stored)).toMatchObject({
      refresh_token: 'refresh-b',
      user: { id: 'user-b' },
    });
  });

  it('does not delete a verifier replaced by a concurrent PKCE flow', async () => {
    const verifierKey = 'sb-project-auth-token-code-verifier';
    let verifier = 'old-verifier';
    const storage = {
      getItem: jest.fn(async (key: string) =>
        key === verifierKey ? JSON.stringify(verifier) : null
      ),
      removeItem: jest.fn(async () => undefined),
      setItem: jest.fn(async (key: string) => {
        if (key === 'sb-project-auth-token') verifier = 'new-verifier';
      }),
    };
    const client = createClient(
      'https://project.supabase.co',
      'publishable-key',
      { auth: { autoRefreshToken: false, persistSession: true, storage } }
    );

    await (client.auth as unknown as SaveSessionAuth)._saveSession(
      session('user-a', 'refresh-a')
    );

    expect(storage.removeItem).not.toHaveBeenCalledWith(verifierKey);
    expect(verifier).toBe('new-verifier');
  });

  it('keeps a committed session successful when verifier cleanup fails', async () => {
    const verifierKey = 'sb-project-auth-token-code-verifier';
    const storage = {
      getItem: jest.fn(async (key: string) =>
        key === verifierKey ? JSON.stringify('verifier') : null
      ),
      removeItem: jest.fn(async (key: string) => {
        if (key === verifierKey) throw new Error('secure storage unavailable');
      }),
      setItem: jest.fn(async () => undefined),
    };
    const client = createClient(
      'https://project.supabase.co',
      'publishable-key',
      { auth: { autoRefreshToken: false, persistSession: true, storage } }
    );

    await expect(
      (client.auth as unknown as SaveSessionAuth)._saveSession(
        session('user-a', 'refresh-a')
      )
    ).resolves.toBeUndefined();
    expect(storage.setItem).toHaveBeenCalledWith(
      'sb-project-auth-token',
      expect.stringContaining('refresh-a')
    );
  });
});
