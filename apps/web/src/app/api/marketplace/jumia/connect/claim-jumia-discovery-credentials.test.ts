import { beforeEach, describe, expect, it, vi } from 'vitest';
import { claimJumiaDiscoveryCredentials } from './claim-jumia-discovery-credentials';

const { mockClaim, mockDecrypt, mockRelease } = vi.hoisted(() => ({
  mockClaim: vi.fn(),
  mockDecrypt: vi.fn(),
  mockRelease: vi.fn(),
}));

vi.mock('@/lib/jumia/self-authorization-discovery-store', () => ({
  claimJumiaSelfAuthorizationDiscovery: mockClaim,
}));
vi.mock('@/lib/jumia/authorization-crypto', () => ({
  jumiaAuthorizationCrypto: {
    decrypt: mockDecrypt,
    buildAuthorizationContext: vi.fn(
      (merchantId: string, clientKeyHash: string) =>
        `${merchantId}:${clientKeyHash}`
    ),
  },
}));
vi.mock('./release-jumia-discovery-claim', () => ({
  releaseJumiaDiscoveryClaim: mockRelease,
}));

const args = {
  discoveryId: 'discovery-1',
  merchantId: 'merchant-1',
  clientKeyHash: 'hash-1',
  encryptionKey: 'key-1',
  supabase: {} as never,
};

describe('claimJumiaDiscoveryCredentials', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the claim and decrypted credentials', async () => {
    mockClaim.mockResolvedValue({
      claimToken: 'claim-1',
      credentialCiphertext: 'ciphertext',
    });
    mockDecrypt.mockReturnValue({
      clientId: 'client-1',
      refreshToken: 'refresh-1',
      accessToken: 'access-1',
    });

    await expect(claimJumiaDiscoveryCredentials(args)).resolves.toEqual({
      claimToken: 'claim-1',
      credentialCiphertext: 'ciphertext',
      credentials: {
        clientId: 'client-1',
        refreshToken: 'refresh-1',
        accessToken: 'access-1',
      },
    });
    expect(mockRelease).not.toHaveBeenCalled();
  });

  it('releases a claim when its credentials cannot be decrypted', async () => {
    mockClaim.mockResolvedValue({
      claimToken: 'claim-1',
      credentialCiphertext: 'ciphertext',
    });
    mockDecrypt.mockImplementation(() => {
      throw new Error('invalid ciphertext');
    });

    await expect(claimJumiaDiscoveryCredentials(args)).rejects.toThrow(
      'invalid ciphertext'
    );
    expect(mockRelease).toHaveBeenCalledWith({
      discoveryId: 'discovery-1',
      merchantId: 'merchant-1',
      claimToken: 'claim-1',
      supabase: args.supabase,
    });
  });

  it('returns null when the discovery claim is unavailable', async () => {
    mockClaim.mockResolvedValue(null);

    await expect(claimJumiaDiscoveryCredentials(args)).resolves.toBeNull();
    expect(mockDecrypt).not.toHaveBeenCalled();
  });
});
