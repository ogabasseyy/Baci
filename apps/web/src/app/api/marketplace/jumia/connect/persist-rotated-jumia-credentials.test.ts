import { beforeEach, describe, expect, it, vi } from 'vitest';
import { persistRotatedJumiaCredentials } from './persist-rotated-jumia-credentials';

const { mockPersist } = vi.hoisted(() => ({
  mockPersist: vi.fn(),
}));

const { mockEncrypt, mockBuildContext } = vi.hoisted(() => ({
  mockEncrypt: vi.fn(() => 'ciphertext'),
  mockBuildContext: vi.fn(
    (merchantId: string, clientKeyHash: string) =>
      `${merchantId}:${clientKeyHash}`
  ),
}));

vi.mock('./persist-jumia-self-authorization-rotation', () => ({
  persistJumiaSelfAuthorizationRotation: mockPersist,
}));
vi.mock('@/lib/jumia/authorization-crypto', () => ({
  jumiaAuthorizationCrypto: {
    encrypt: mockEncrypt,
    buildAuthorizationContext: mockBuildContext,
  },
}));

const credentials = {
  clientId: 'client-1',
  refreshToken: 'refresh-1',
  accessToken: 'access-1',
};

describe('persistRotatedJumiaCredentials', () => {
  beforeEach(() => vi.clearAllMocks());

  it('persists encrypted credentials before discovery storage', async () => {
    const events: string[] = [];
    mockEncrypt.mockImplementationOnce(() => {
      events.push('encrypt');
      return 'ciphertext';
    });
    mockPersist.mockImplementationOnce(async () => {
      events.push('persist');
      return 7;
    });

    const result = await persistRotatedJumiaCredentials({
      credentials,
      encryptionKey: 'key',
      supabase: {} as never,
      merchantId: 'merchant-1',
      clientKeyHash: 'hash-1',
      accessTokenExpiresAt: '2026-08-31T12:00:00.000Z',
      refreshTokenExpiresAt: '2026-09-30T12:00:00.000Z',
    });

    expect(result).toEqual({
      credentialCiphertext: 'ciphertext',
      expectedRotationVersion: 7,
    });
    expect(events).toEqual(['encrypt', 'persist']);
    expect(mockPersist).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantId: 'merchant-1',
        clientKeyHash: 'hash-1',
        credentialCiphertext: 'ciphertext',
      })
    );
  });

  it('does not report success when credential persistence fails', async () => {
    mockPersist.mockRejectedValueOnce(new Error('persistence unavailable'));

    await expect(
      persistRotatedJumiaCredentials({
        credentials,
        encryptionKey: 'key',
        supabase: {} as never,
        merchantId: 'merchant-1',
        clientKeyHash: 'hash-1',
        accessTokenExpiresAt: '2026-08-31T12:00:00.000Z',
        refreshTokenExpiresAt: '2026-09-30T12:00:00.000Z',
      })
    ).rejects.toThrow('persistence unavailable');
  });
});
