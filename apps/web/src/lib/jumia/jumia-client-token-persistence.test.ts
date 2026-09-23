import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JumiaApiError } from '@/lib/jumia/helpers';

const encrypt = vi.fn();
const decrypt = vi.fn();
const rpc = vi.fn();

vi.mock('@/env', () => ({
  getJumiaAuthorizationEncryptionKey: () => 'test-key',
}));

vi.mock('@/lib/jumia/authorization-crypto', () => ({
  jumiaAuthorizationCrypto: {
    buildAuthorizationContext: (merchantId: string, clientKeyHash: string) =>
      `${merchantId}:${clientKeyHash}`,
    encrypt: (...args: unknown[]) => encrypt(...args),
    decrypt: (...args: unknown[]) => decrypt(...args),
  },
}));

vi.mock('@/lib/jumia/load-jumia-authorization-grant', () => ({
  loadJumiaAuthorizationGrant: vi.fn().mockResolvedValue({
    credential_ciphertext: 'stored-ciphertext',
    token_expires_at: '2026-03-27T10:00:00.000Z',
    refresh_token_expires_at: '2026-03-28T10:00:00.000Z',
    rotation_version: 1,
    client_key_hash: 'a'.repeat(64),
  }),
}));

import { loadJumiaAuthorizationGrant } from '@/lib/jumia/load-jumia-authorization-grant';
import { refreshJumiaClientAccessToken } from './jumia-client-token-persistence';

describe('refreshJumiaClientAccessToken', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    encrypt.mockReturnValue('encrypted-ciphertext');
    rpc.mockReset();
  });

  it('throws when refresh token is missing', async () => {
    const update = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }),
    });
    const supabase = {
      from: vi.fn().mockReturnValue({ update }),
    };

    await expect(
      refreshJumiaClientAccessToken(
        {
          integrationId: 'integration-1',
          merchantId: 'merchant-1',
          accessToken: 'access',
          refreshToken: '   ',
          clientId: 'client-id',
          tokenExpiresAt: null,
          supabase: supabase as never,
          apiBase: 'https://api.jumia.test',
        },
        vi.fn()
      )
    ).rejects.toBeInstanceOf(JumiaApiError);
  });

  it('encrypts the refreshed access token into rotated credentials', async () => {
    rpc
      .mockResolvedValueOnce({
        data: 'lease-token',
        error: null,
      })
      .mockResolvedValueOnce({
        data: 2,
        error: null,
      });
    const supabase = { rpc };
    const fetchWithThrottle = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: 'fresh-access-token',
          refresh_token: 'fresh-refresh-token',
          expires_in: 3600,
          refresh_expires_in: 86400,
          token_type: 'Bearer',
        }),
        { status: 200 }
      )
    );

    const result = await refreshJumiaClientAccessToken(
      {
        integrationId: 'integration-1',
        merchantId: 'merchant-1',
        accessToken: 'stale-access',
        refreshToken: 'refresh-token',
        clientId: 'client-id',
        authorizationId: 'auth-1',
        authorizationRotationVersion: 1,
        tokenExpiresAt: null,
        refreshTokenExpiresAt: null,
        supabase: supabase as never,
        apiBase: 'https://api.jumia.test',
      },
      fetchWithThrottle
    );

    expect(result.accessToken).toBe('fresh-access-token');
    expect(encrypt).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: 'fresh-access-token',
        refreshToken: 'fresh-refresh-token',
      }),
      'test-key',
      `merchant-1:${'a'.repeat(64)}`
    );
    expect(rpc).toHaveBeenNthCalledWith(
      1,
      'claim_jumia_authorization_refresh_lease',
      expect.objectContaining({
        p_authorization_id: 'auth-1',
        p_expected_rotation_version: 1,
      })
    );
    expect(rpc).toHaveBeenNthCalledWith(
      2,
      'rotate_jumia_authorization_credentials',
      expect.objectContaining({
        p_credential_ciphertext: 'encrypted-ciphertext',
        p_refresh_token_expires_at: expect.any(String),
        p_refresh_lease_token: 'lease-token',
      })
    );
  });

  it('exchanges carried credentials when a rotation wins during the lease wait', async () => {
    vi.mocked(loadJumiaAuthorizationGrant).mockResolvedValue({
      credential_ciphertext: 'stored-ciphertext',
      token_expires_at: '2026-01-01T00:00:00.000Z',
      refresh_token_expires_at: '2026-12-31T10:00:00.000Z',
      rotation_version: 2,
      client_key_hash: 'a'.repeat(64),
    } as never);
    decrypt.mockReturnValue({
      accessToken: 'winner-access',
      refreshToken: 'winner-refresh',
      clientId: 'client-id',
    });
    rpc
      .mockResolvedValueOnce({
        data: null,
        error: { code: '40001', message: 'Stale Jumia authorization rotation' },
      })
      .mockResolvedValueOnce({ data: 'lease-token', error: null })
      .mockResolvedValueOnce({ data: 3, error: null });
    const supabase = { rpc };
    const fetchWithThrottle = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: 'fresh-access-token',
          refresh_token: 'fresh-refresh-token',
          expires_in: 3600,
          refresh_expires_in: 86400,
          token_type: 'Bearer',
        }),
        { status: 200 }
      )
    );

    await refreshJumiaClientAccessToken(
      {
        integrationId: 'integration-1',
        merchantId: 'merchant-1',
        accessToken: 'stale-access',
        refreshToken: 'consumed-refresh-token',
        clientId: 'client-id',
        authorizationId: 'auth-1',
        authorizationRotationVersion: 1,
        tokenExpiresAt: null,
        refreshTokenExpiresAt: null,
        supabase: supabase as never,
        apiBase: 'https://api.jumia.test',
      },
      fetchWithThrottle
    );

    const body = fetchWithThrottle.mock.calls[0]?.[1]?.body as URLSearchParams;
    expect(body.get('refresh_token')).toBe('winner-refresh');
    expect(rpc).toHaveBeenNthCalledWith(
      3,
      'rotate_jumia_authorization_credentials',
      expect.objectContaining({ p_expected_rotation_version: 2 })
    );
  });

  it('reuses an in-flight refresh for the same authorization grant', async () => {
    rpc.mockImplementation(async (name: string) => {
      if (name === 'claim_jumia_authorization_refresh_lease') {
        return { data: 'lease-token', error: null };
      }
      return { data: 2, error: null };
    });
    const supabase = { rpc };
    let releaseFetch: (() => void) | undefined;
    const fetchGate = new Promise<void>((resolve) => {
      releaseFetch = resolve;
    });
    const fetchWithThrottle = vi.fn().mockImplementation(async () => {
      await fetchGate;
      return new Response(
        JSON.stringify({
          access_token: 'fresh-access-token',
          refresh_token: 'fresh-refresh-token',
          expires_in: 3600,
          refresh_expires_in: 86400,
          token_type: 'Bearer',
        }),
        { status: 200 }
      );
    });
    const state = {
      integrationId: 'integration-1',
      merchantId: 'merchant-1',
      accessToken: 'stale-access',
      refreshToken: 'refresh-token',
      clientId: 'client-id',
      authorizationId: 'auth-1',
      authorizationRotationVersion: 1,
      tokenExpiresAt: null,
      refreshTokenExpiresAt: null,
      supabase: supabase as never,
      apiBase: 'https://api.jumia.test',
    };

    const firstRefresh = refreshJumiaClientAccessToken(
      state,
      fetchWithThrottle
    );
    const secondRefresh = refreshJumiaClientAccessToken(
      state,
      fetchWithThrottle
    );

    releaseFetch?.();
    const [firstResult, secondResult] = await Promise.all([
      firstRefresh,
      secondRefresh,
    ]);

    expect(firstResult.accessToken).toBe('fresh-access-token');
    expect(secondResult.accessToken).toBe('fresh-access-token');
    expect(fetchWithThrottle).toHaveBeenCalledTimes(1);
  });

  it('fails closed when self-authorization refresh omits rotated credentials', async () => {
    rpc
      .mockResolvedValueOnce({ data: 'lease-token', error: null })
      .mockResolvedValueOnce({ data: true, error: null });
    const fetchWithThrottle = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: 'fresh-access-token',
          expires_in: 3600,
          token_type: 'Bearer',
        }),
        { status: 200 }
      )
    );

    await expect(
      refreshJumiaClientAccessToken(
        {
          integrationId: 'integration-1',
          merchantId: 'merchant-1',
          accessToken: 'stale-access',
          refreshToken: 'refresh-token',
          clientId: 'client-id',
          authorizationId: 'auth-1',
          authorizationRotationVersion: 1,
          tokenExpiresAt: null,
          refreshTokenExpiresAt: new Date('2026-03-28T10:00:00.000Z'),
          supabase: { rpc } as never,
          apiBase: 'https://api.jumia.test',
        },
        fetchWithThrottle
      )
    ).rejects.toMatchObject({
      status: 502,
      message:
        'Jumia API Error (502): Jumia did not return a rotated refresh token and expiry',
    });

    expect(encrypt).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith(
      'release_jumia_authorization_refresh_lease',
      expect.objectContaining({
        p_authorization_id: 'auth-1',
        p_refresh_lease_token: 'lease-token',
      })
    );
  });

  it('does not retain provider error bodies and releases the lease on refresh failure', async () => {
    rpc
      .mockResolvedValueOnce({ data: 'lease-token', error: null })
      .mockResolvedValueOnce({ data: true, error: null });
    const fetchWithThrottle = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ refresh_token: 'secret-token' }), {
        status: 401,
      })
    );

    await expect(
      refreshJumiaClientAccessToken(
        {
          integrationId: 'integration-1',
          merchantId: 'merchant-1',
          accessToken: 'stale-access',
          refreshToken: 'refresh-token',
          clientId: 'client-id',
          authorizationId: 'auth-1',
          authorizationRotationVersion: 1,
          tokenExpiresAt: null,
          refreshTokenExpiresAt: null,
          supabase: { rpc } as never,
          apiBase: 'https://api.jumia.test',
        },
        fetchWithThrottle
      )
    ).rejects.toMatchObject({
      status: 401,
      details: undefined,
    });

    expect(rpc).toHaveBeenLastCalledWith(
      'release_jumia_authorization_refresh_lease',
      expect.objectContaining({ p_refresh_lease_token: 'lease-token' })
    );
  });
});
