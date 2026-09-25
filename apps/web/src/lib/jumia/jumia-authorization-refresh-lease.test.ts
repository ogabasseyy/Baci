import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadJumiaAuthorizationGrant } from '@/lib/jumia/load-jumia-authorization-grant';

vi.mock('@/env', () => ({
  getJumiaAuthorizationEncryptionKey: () => 'test-key',
  getSupabaseServiceRoleKey: () => 'test-service-role-key',
  getSupabaseUrl: () => 'https://example.supabase.co',
}));

vi.mock('@/lib/jumia/authorization-crypto', () => ({
  jumiaAuthorizationCrypto: {
    buildAuthorizationContext: (merchantId: string, clientKeyHash: string) =>
      `${merchantId}:${clientKeyHash}`,
    decrypt: vi.fn().mockReturnValue({
      accessToken: 'fresh-access',
      refreshToken: 'fresh-refresh',
      clientId: 'client-id',
    }),
  },
}));

vi.mock('@/lib/jumia/load-jumia-authorization-grant', () => ({
  loadJumiaAuthorizationGrant: vi.fn(),
}));

import {
  acquireJumiaAuthorizationRefreshLease,
  claimJumiaAuthorizationRefreshLease,
  REFRESH_LEASE_BUSY_RETRIES,
  releaseJumiaAuthorizationRefreshLease,
} from './jumia-authorization-refresh-lease';

const refreshState = {
  integrationId: 'integration-1',
  merchantId: 'merchant-1',
  authorizationId: 'auth-1',
  authorizationRotationVersion: 1,
  tokenExpiresAt: new Date('2026-01-01T00:00:00.000Z'),
};

describe('acquireJumiaAuthorizationRefreshLease', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadJumiaAuthorizationGrant).mockResolvedValue({
      credential_ciphertext: 'stored-ciphertext',
      token_expires_at: '2026-12-31T10:00:00.000Z',
      refresh_token_expires_at: '2026-12-31T10:00:00.000Z',
      rotation_version: 2,
      client_key_hash: 'a'.repeat(64),
    } as never);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns reloaded credentials when another refresh finishes while lease is busy', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: '55P03', message: 'refresh already in progress' },
    });
    const supabase = { rpc };

    const result = await acquireJumiaAuthorizationRefreshLease(
      {
        integrationId: 'integration-1',
        merchantId: 'merchant-1',
        authorizationId: 'auth-1',
        authorizationRotationVersion: 1,
        tokenExpiresAt: new Date('2026-01-01T00:00:00.000Z'),
      },
      supabase as never
    );

    expect(result).toEqual({
      reloaded: expect.objectContaining({
        accessToken: 'fresh-access',
        authorizationRotationVersion: 2,
        refreshTokenExpiresAt: new Date('2026-12-31T10:00:00.000Z'),
      }),
    });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('throws 503 when the refresh lease stays busy without fresher credentials', async () => {
    vi.mocked(loadJumiaAuthorizationGrant).mockResolvedValue({
      credential_ciphertext: 'stored-ciphertext',
      token_expires_at: '2026-01-01T00:00:00.000Z',
      refresh_token_expires_at: '2026-01-01T00:00:00.000Z',
      rotation_version: 1,
      client_key_hash: 'a'.repeat(64),
    } as never);

    const setTimeoutSpy = vi
      .spyOn(global, 'setTimeout')
      .mockImplementation((handler) => {
        if (typeof handler === 'function') {
          handler();
        }
        return 0 as never;
      });

    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: '55P03', message: 'refresh already in progress' },
    });
    const supabase = { rpc };

    await expect(
      acquireJumiaAuthorizationRefreshLease(
        {
          integrationId: 'integration-1',
          merchantId: 'merchant-1',
          authorizationId: 'auth-1',
          authorizationRotationVersion: 1,
          tokenExpiresAt: new Date('2026-01-01T00:00:00.000Z'),
        },
        supabase as never
      )
    ).rejects.toMatchObject({
      status: 503,
    });

    expect(rpc).toHaveBeenCalledTimes(REFRESH_LEASE_BUSY_RETRIES);
    setTimeoutSpy.mockRestore();
  });

  it('does not return expired credentials just because rotation version advanced', async () => {
    vi.mocked(loadJumiaAuthorizationGrant).mockResolvedValue({
      credential_ciphertext: 'stored-ciphertext',
      token_expires_at: '2026-01-01T00:00:00.000Z',
      refresh_token_expires_at: '2026-12-31T10:00:00.000Z',
      rotation_version: 2,
      client_key_hash: 'a'.repeat(64),
    } as never);

    const setTimeoutSpy = vi
      .spyOn(global, 'setTimeout')
      .mockImplementation((handler) => {
        if (typeof handler === 'function') handler();
        return 0 as never;
      });
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: '55P03', message: 'refresh already in progress' },
    });

    await expect(
      acquireJumiaAuthorizationRefreshLease(
        {
          integrationId: 'integration-1',
          merchantId: 'merchant-1',
          authorizationId: 'auth-1',
          authorizationRotationVersion: 1,
          tokenExpiresAt: new Date('2026-01-01T00:00:00.000Z'),
        },
        { rpc } as never
      )
    ).rejects.toMatchObject({ status: 503 });

    expect(rpc).toHaveBeenCalledTimes(REFRESH_LEASE_BUSY_RETRIES);
    setTimeoutSpy.mockRestore();
  });

  it('carries reloaded credentials into the retry when the version advances', async () => {
    // Another worker won the rotation, but its access token is older than
    // this caller's cached expiry, so the reload is not fresh enough to
    // reuse. The eventual claim must carry the winner's live refresh token
    // because the caller's original token is already consumed.
    vi.mocked(loadJumiaAuthorizationGrant).mockResolvedValue({
      credential_ciphertext: 'stored-ciphertext',
      token_expires_at: '2026-01-01T00:00:00.000Z',
      refresh_token_expires_at: '2026-12-31T10:00:00.000Z',
      rotation_version: 2,
      client_key_hash: 'a'.repeat(64),
    } as never);

    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: null,
        error: { code: '40001', message: 'Stale Jumia authorization rotation' },
      })
      .mockResolvedValueOnce({ data: 'lease-token', error: null });
    const supabase = { rpc };

    const result = await acquireJumiaAuthorizationRefreshLease(
      refreshState,
      supabase as never
    );

    expect(result).toEqual({
      leaseToken: 'lease-token',
      authorizationRotationVersion: 2,
      carriedCredentials: {
        refreshToken: 'fresh-refresh',
        clientId: 'client-id',
        authorizationRotationVersion: 2,
      },
    });
  });

  it('returns a clear forbidden error when view-only refresh is denied', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: {
        code: '42501',
        message: 'Not authorized to refresh Jumia credentials',
      },
    });

    await expect(
      claimJumiaAuthorizationRefreshLease(refreshState, { rpc } as never)
    ).rejects.toMatchObject({
      status: 403,
      message: expect.stringContaining('integrations.manage'),
    });
  });
});

describe('releaseJumiaAuthorizationRefreshLease', () => {
  it('releases only the matching lease token', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });

    await expect(
      releaseJumiaAuthorizationRefreshLease({
        authorizationId: 'auth-1',
        merchantId: 'merchant-1',
        leaseToken: 'lease-1',
        supabase: { rpc } as never,
      })
    ).resolves.toBe(true);

    expect(rpc).toHaveBeenCalledWith(
      'release_jumia_authorization_refresh_lease',
      {
        p_authorization_id: 'auth-1',
        p_merchant_id: 'merchant-1',
        p_refresh_lease_token: 'lease-1',
      }
    );
  });
});
