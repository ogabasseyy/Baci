import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JumiaAuthorizationDecryptionError } from '@/lib/jumia/authorization-crypto';
import { releaseJumiaAuthorizationRefreshLease } from '@/lib/jumia/jumia-authorization-refresh-lease';
import { validateJumiaSelfAuthorization } from '@/lib/jumia/self-authorization';
import { claimJumiaResumedAuthorization } from './claim-jumia-resumed-authorization';
import { persistRotatedJumiaCredentials } from './persist-rotated-jumia-credentials';
import { persistRotatedJumiaCredentialsWithLease } from './persist-rotated-jumia-credentials-with-lease';
import { validateJumiaSelfAuthorizationForConnect } from './validate-jumia-self-authorization-for-connect';

vi.mock('./claim-jumia-resumed-authorization', () => ({
  claimJumiaResumedAuthorization: vi.fn(),
}));
vi.mock('./persist-rotated-jumia-credentials', () => ({
  persistRotatedJumiaCredentials: vi.fn(),
}));
vi.mock('./persist-rotated-jumia-credentials-with-lease', () => ({
  persistRotatedJumiaCredentialsWithLease: vi.fn(),
}));
vi.mock('@/lib/jumia/jumia-authorization-refresh-lease', () => ({
  releaseJumiaAuthorizationRefreshLease: vi.fn(),
}));
vi.mock('@/lib/jumia/self-authorization', () => ({
  validateJumiaSelfAuthorization: vi.fn(),
}));

const credentials = {
  clientId: 'client-1',
  refreshToken: 'refresh-1',
};
const validated = {
  credentials: { ...credentials, accessToken: 'access-1' },
  accessTokenExpiresAt: '2026-08-31T13:00:00.000Z',
  refreshTokenExpiresAt: '2026-09-30T12:00:00.000Z',
  shops: [],
};

describe('validateJumiaSelfAuthorizationForConnect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(validateJumiaSelfAuthorization).mockResolvedValue(validated);
    vi.mocked(persistRotatedJumiaCredentials).mockResolvedValue({
      credentialCiphertext: 'ordinary-ciphertext',
      expectedRotationVersion: 2,
    });
    vi.mocked(persistRotatedJumiaCredentialsWithLease).mockResolvedValue({
      credentialCiphertext: 'leased-ciphertext',
      expectedRotationVersion: 3,
    });
    vi.mocked(claimJumiaResumedAuthorization).mockResolvedValue(null);
  });

  it('uses ordinary persistence for a new discovery', async () => {
    const onCredentialsRotated = vi.fn();
    vi.mocked(validateJumiaSelfAuthorization).mockImplementationOnce(
      async (_credentials, options) => {
        await options?.onCredentialsRotated?.({
          credentials: { ...credentials, accessToken: 'access-1' },
          accessTokenExpiresAt: validated.accessTokenExpiresAt,
          refreshTokenExpiresAt: validated.refreshTokenExpiresAt,
        });
        return validated;
      }
    );

    await validateJumiaSelfAuthorizationForConnect({
      clientKeyHash: 'hash-1',
      encryptionKey: 'key',
      merchantId: 'merchant-1',
      onCredentialsRotated,
      submittedCredentials: credentials,
      supabase: {} as never,
    });

    expect(persistRotatedJumiaCredentials).toHaveBeenCalled();
    expect(persistRotatedJumiaCredentialsWithLease).not.toHaveBeenCalled();
    expect(claimJumiaResumedAuthorization).toHaveBeenCalledWith(
      expect.objectContaining({ clientKeyHash: 'hash-1' })
    );
    expect(onCredentialsRotated).toHaveBeenCalledWith({
      credentialCiphertext: 'ordinary-ciphertext',
      expectedRotationVersion: 2,
    });
  });

  it('serializes a fresh discovery against an existing grant without replacing submitted credentials', async () => {
    vi.mocked(claimJumiaResumedAuthorization).mockResolvedValue({
      credentials: { clientId: 'client-1', refreshToken: 'stored-refresh' },
      authorizationId: 'auth-1',
      authorizationRotationVersion: 3,
      leaseToken: 'lease-1',
    });
    vi.mocked(validateJumiaSelfAuthorization).mockImplementationOnce(
      async (submitted, options) => {
        expect(submitted).toEqual(credentials);
        await options?.onCredentialsRotated?.({
          credentials: { ...credentials, accessToken: 'access-1' },
          accessTokenExpiresAt: validated.accessTokenExpiresAt,
          refreshTokenExpiresAt: validated.refreshTokenExpiresAt,
        });
        return validated;
      }
    );
    const onCredentialsRotated = vi.fn();

    await validateJumiaSelfAuthorizationForConnect({
      clientKeyHash: 'hash-1',
      encryptionKey: 'key',
      merchantId: 'merchant-1',
      onCredentialsRotated,
      submittedCredentials: credentials,
      supabase: {} as never,
    });

    expect(persistRotatedJumiaCredentialsWithLease).toHaveBeenCalledWith(
      expect.objectContaining({
        authorizationId: 'auth-1',
        authorizationRotationVersion: 3,
        refreshLeaseToken: 'lease-1',
      })
    );
    expect(persistRotatedJumiaCredentials).not.toHaveBeenCalled();
    expect(onCredentialsRotated).toHaveBeenCalledWith({
      credentialCiphertext: 'leased-ciphertext',
      expectedRotationVersion: 3,
    });
  });

  it('uses the lease-protected credentials and persistence when resuming', async () => {
    vi.mocked(claimJumiaResumedAuthorization).mockResolvedValue({
      credentials: { clientId: 'client-1', refreshToken: 'fresh-refresh' },
      authorizationId: 'auth-1',
      authorizationRotationVersion: 3,
      leaseToken: 'lease-1',
    });
    vi.mocked(validateJumiaSelfAuthorization).mockImplementationOnce(
      async (submitted, options) => {
        expect(submitted).toEqual({
          clientId: 'client-1',
          refreshToken: 'fresh-refresh',
        });
        await options?.onCredentialsRotated?.({
          credentials: {
            clientId: 'client-1',
            refreshToken: 'rotated-refresh',
            accessToken: 'access-2',
          },
          accessTokenExpiresAt: validated.accessTokenExpiresAt,
          refreshTokenExpiresAt: validated.refreshTokenExpiresAt,
        });
        return validated;
      }
    );
    const onCredentialsRotated = vi.fn();

    await validateJumiaSelfAuthorizationForConnect({
      clientKeyHash: 'hash-1',
      discoveryId: 'discovery-1',
      encryptionKey: 'key',
      merchantId: 'merchant-1',
      onCredentialsRotated,
      submittedCredentials: credentials,
      supabase: {} as never,
    });

    expect(claimJumiaResumedAuthorization).toHaveBeenCalledWith(
      expect.objectContaining({ clientKeyHash: 'hash-1' })
    );
    expect(persistRotatedJumiaCredentialsWithLease).toHaveBeenCalledWith(
      expect.objectContaining({
        authorizationId: 'auth-1',
        authorizationRotationVersion: 3,
        clientKeyHash: 'hash-1',
        refreshLeaseToken: 'lease-1',
      })
    );
    expect(persistRotatedJumiaCredentials).not.toHaveBeenCalled();
    expect(onCredentialsRotated).toHaveBeenCalledWith({
      credentialCiphertext: 'leased-ciphertext',
      expectedRotationVersion: 3,
    });
  });

  it('bypasses an unreadable stored grant for explicit reauthorization', async () => {
    vi.mocked(claimJumiaResumedAuthorization).mockRejectedValue(
      new JumiaAuthorizationDecryptionError()
    );
    vi.mocked(validateJumiaSelfAuthorization).mockImplementationOnce(
      async (submitted) => {
        expect(submitted).toEqual(credentials);
        return validated;
      }
    );

    await validateJumiaSelfAuthorizationForConnect({
      clientKeyHash: 'hash-1',
      encryptionKey: 'key',
      merchantId: 'merchant-1',
      onCredentialsRotated: vi.fn(),
      submittedCredentials: credentials,
      supabase: {} as never,
    });

    expect(claimJumiaResumedAuthorization).toHaveBeenCalled();
    expect(persistRotatedJumiaCredentialsWithLease).not.toHaveBeenCalled();
  });

  it('fails closed when the refresh lease cannot be claimed', async () => {
    const failure = new Error(
      'Jumia authorization refresh is still in progress'
    );
    vi.mocked(claimJumiaResumedAuthorization).mockRejectedValue(failure);

    await expect(
      validateJumiaSelfAuthorizationForConnect({
        clientKeyHash: 'hash-1',
        encryptionKey: 'key',
        merchantId: 'merchant-1',
        onCredentialsRotated: vi.fn(),
        submittedCredentials: credentials,
        supabase: {} as never,
      })
    ).rejects.toBe(failure);

    expect(validateJumiaSelfAuthorization).not.toHaveBeenCalled();
    expect(persistRotatedJumiaCredentials).not.toHaveBeenCalled();
    expect(persistRotatedJumiaCredentialsWithLease).not.toHaveBeenCalled();
  });

  it('fails closed when the stored grant cannot be loaded', async () => {
    const failure = new Error('Failed to load existing Jumia authorization');
    vi.mocked(claimJumiaResumedAuthorization).mockRejectedValue(failure);

    await expect(
      validateJumiaSelfAuthorizationForConnect({
        clientKeyHash: 'hash-1',
        encryptionKey: 'key',
        merchantId: 'merchant-1',
        onCredentialsRotated: vi.fn(),
        submittedCredentials: credentials,
        supabase: {} as never,
      })
    ).rejects.toBe(failure);

    expect(validateJumiaSelfAuthorization).not.toHaveBeenCalled();
  });

  it('releases a resumed refresh lease when validation fails before rotation', async () => {
    vi.mocked(claimJumiaResumedAuthorization).mockResolvedValue({
      credentials: { clientId: 'client-1', refreshToken: 'fresh-refresh' },
      authorizationId: 'auth-1',
      authorizationRotationVersion: 3,
      leaseToken: 'lease-1',
    });
    const failure = new Error('Jumia rejected the refresh token');
    vi.mocked(validateJumiaSelfAuthorization).mockRejectedValueOnce(failure);

    await expect(
      validateJumiaSelfAuthorizationForConnect({
        clientKeyHash: 'hash-1',
        discoveryId: 'discovery-1',
        encryptionKey: 'key',
        merchantId: 'merchant-1',
        onCredentialsRotated: vi.fn(),
        submittedCredentials: credentials,
        supabase: {} as never,
      })
    ).rejects.toBe(failure);

    expect(releaseJumiaAuthorizationRefreshLease).toHaveBeenCalledWith({
      authorizationId: 'auth-1',
      merchantId: 'merchant-1',
      leaseToken: 'lease-1',
      supabase: {},
    });
  });
});
