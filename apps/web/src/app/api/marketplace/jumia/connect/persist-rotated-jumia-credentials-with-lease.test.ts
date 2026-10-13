import { beforeEach, describe, expect, it, vi } from 'vitest';
import { persistRotatedJumiaCredentialsWithLease } from './persist-rotated-jumia-credentials-with-lease';

const { encrypt, rpc } = vi.hoisted(() => ({
  encrypt: vi.fn(() => 'ciphertext'),
  rpc: vi.fn(),
}));

vi.mock('@/lib/jumia/authorization-crypto', () => ({
  jumiaAuthorizationCrypto: {
    encrypt,
    buildAuthorizationContext: vi.fn(
      (merchantId: string, authorizationId: string) =>
        `${merchantId}:${authorizationId}`
    ),
  },
}));

const credentials = {
  clientId: 'client-1',
  refreshToken: 'refresh-1',
  accessToken: 'access-1',
};

describe('persistRotatedJumiaCredentialsWithLease', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rpc.mockResolvedValue({ data: 2, error: null });
  });

  it('rotates credentials through the lease-protected RPC', async () => {
    const result = await persistRotatedJumiaCredentialsWithLease({
      authorizationId: 'auth-1',
      authorizationRotationVersion: 1,
      clientKeyHash: 'hash-1',
      credentials,
      encryptionKey: 'key',
      merchantId: 'merchant-1',
      refreshLeaseToken: 'lease-1',
      refreshTokenExpiresAt: '2026-09-30T12:00:00.000Z',
      supabase: { rpc } as never,
      accessTokenExpiresAt: '2026-08-31T13:00:00.000Z',
    });

    expect(result).toEqual({
      credentialCiphertext: 'ciphertext',
      expectedRotationVersion: 1,
    });
    expect(rpc).toHaveBeenCalledWith(
      'rotate_jumia_authorization_credentials',
      expect.objectContaining({
        p_authorization_id: 'auth-1',
        p_expected_rotation_version: 1,
        p_refresh_lease_token: 'lease-1',
        p_refresh_token_expires_at: '2026-09-30T12:00:00.000Z',
      })
    );
  });

  it('fails when the lease-protected rotation cannot be persisted', async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'stale lease' },
    });

    await expect(
      persistRotatedJumiaCredentialsWithLease({
        authorizationId: 'auth-1',
        authorizationRotationVersion: 1,
        clientKeyHash: 'hash-1',
        credentials,
        encryptionKey: 'key',
        merchantId: 'merchant-1',
        refreshLeaseToken: 'lease-1',
        refreshTokenExpiresAt: '2026-09-30T12:00:00.000Z',
        supabase: { rpc } as never,
        accessTokenExpiresAt: '2026-08-31T13:00:00.000Z',
      })
    ).rejects.toThrow('Failed to persist rotated Jumia authorization');
  });
});
