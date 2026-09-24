import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JumiaApiError } from '@/lib/jumia/helpers';
import {
  loadJumiaIntegrationConfig,
  loadSingleJumiaMerchantIntegrationConfig,
} from '@/lib/jumia/jumia-client-config';

const mockDecrypt = vi.fn();
const mockLoadGrant = vi.fn();

vi.mock('@/env', () => ({
  getJumiaAuthorizationEncryptionKey: vi.fn(),
}));

vi.mock('@/lib/jumia/authorization-crypto', () => ({
  jumiaAuthorizationCrypto: {
    buildAuthorizationContext: (merchantId: string, clientKeyHash: string) =>
      `${merchantId}:${clientKeyHash}`,
    decrypt: (...args: unknown[]) => mockDecrypt(...args),
  },
}));

vi.mock('@/lib/jumia/load-jumia-authorization-grant', () => ({
  loadJumiaAuthorizationGrant: (...args: unknown[]) => mockLoadGrant(...args),
}));

function createMockSupabase(response: { data: unknown; error: unknown }) {
  const chainable = {
    eq: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(response),
  };

  Object.defineProperty(chainable, 'then', {
    value(resolve: (value: unknown) => void, reject: (error: unknown) => void) {
      return Promise.resolve(response).then(resolve, reject);
    },
  });

  return {
    from: vi.fn(() => ({
      select: vi.fn(() => chainable),
    })),
    chainable,
  } as unknown as import('@supabase/supabase-js').SupabaseClient & {
    chainable: typeof chainable;
  };
}

describe('jumia-client-config', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads a merchant-scoped integration config by id', async () => {
    const supabase = createMockSupabase({
      data: {
        id: 'int-123',
        merchant_id: 'merchant-abc',
        shop_id: 'shop-456',
        country_code: 'NG',
        marketplace_key: 'default',
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        token_expires_at: '2026-03-27T10:00:00.000Z',
        connection_method: 'oauth',
        jumia_authorization_id: null,
      },
      error: null,
    });

    const config = await loadJumiaIntegrationConfig(
      supabase,
      'merchant-abc',
      'int-123'
    );

    expect(config).toMatchObject({
      integrationId: 'int-123',
      merchantId: 'merchant-abc',
      shopId: 'shop-456',
      countryCode: 'NG',
      marketplaceKey: 'default',
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
    });
    expect(config.tokenExpiresAt).toBeInstanceOf(Date);
    expect(supabase.from).toHaveBeenCalledWith('marketplace_integrations');
    expect(mockLoadGrant).not.toHaveBeenCalled();
  });

  it('throws when multiple active integrations exist for a merchant', async () => {
    const supabase = createMockSupabase({
      data: [
        { id: 'int-1', merchant_id: 'merchant-abc' },
        { id: 'int-2', merchant_id: 'merchant-abc' },
      ],
      error: null,
    });

    const error = await loadSingleJumiaMerchantIntegrationConfig(
      supabase,
      'merchant-abc'
    ).catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      status: 400,
      message: expect.stringContaining('Multiple active Jumia integrations'),
    });
  });

  it('throws when self-authorization encryption is not configured', async () => {
    const { getJumiaAuthorizationEncryptionKey } = await import('@/env');
    vi.mocked(getJumiaAuthorizationEncryptionKey).mockReturnValue(undefined);
    const supabase = createMockSupabase({
      data: {
        id: 'int-123',
        merchant_id: 'merchant-abc',
        shop_id: 'shop-456',
        country_code: 'NG',
        marketplace_key: 'default',
        access_token: null,
        refresh_token: null,
        token_expires_at: null,
        connection_method: 'self_authorization',
        jumia_authorization_id: 'auth-1',
      },
      error: null,
    });

    await expect(
      loadJumiaIntegrationConfig(supabase, 'merchant-abc', 'int-123')
    ).rejects.toThrow(
      /Jumia API Error \(500\): Jumia authorization encryption is not configured/
    );
  });

  it('loads decrypted self-authorization credentials through the worker RPC', async () => {
    const { getJumiaAuthorizationEncryptionKey } = await import('@/env');
    vi.mocked(getJumiaAuthorizationEncryptionKey).mockReturnValue('test-key');
    mockLoadGrant.mockResolvedValue({
      credential_ciphertext: 'opaque-ciphertext',
      token_expires_at: '2026-04-01T10:00:00.000Z',
      refresh_token_expires_at: '2026-05-01T10:00:00.000Z',
      rotation_version: 3,
      client_key_hash: 'c'.repeat(64),
    });
    mockDecrypt.mockReturnValue({
      clientId: 'client-id',
      refreshToken: 'shared-refresh',
      accessToken: 'shared-access',
    });
    const supabase = createMockSupabase({
      data: {
        id: 'int-123',
        merchant_id: 'merchant-abc',
        shop_id: 'shop-456',
        country_code: 'NG',
        marketplace_key: 'default',
        access_token: null,
        refresh_token: null,
        token_expires_at: null,
        connection_method: 'self_authorization',
        jumia_authorization_id: 'auth-1',
      },
      error: null,
    });

    const config = await loadJumiaIntegrationConfig(
      supabase,
      'merchant-abc',
      'int-123'
    );

    expect(mockLoadGrant).toHaveBeenCalledWith(
      supabase,
      'auth-1',
      'merchant-abc'
    );
    expect(mockDecrypt).toHaveBeenCalledWith(
      'opaque-ciphertext',
      'test-key',
      `merchant-abc:${'c'.repeat(64)}`
    );
    expect(config).toMatchObject({
      accessToken: 'shared-access',
      refreshToken: 'shared-refresh',
      clientId: 'client-id',
      authorizationId: 'auth-1',
      authorizationRotationVersion: 3,
    });
    expect(config.refreshTokenExpiresAt).toEqual(
      new Date('2026-05-01T10:00:00.000Z')
    );
  });

  it('reads the grant through the restricted credential client when provided', async () => {
    const { getJumiaAuthorizationEncryptionKey } = await import('@/env');
    vi.mocked(getJumiaAuthorizationEncryptionKey).mockReturnValue('test-key');
    mockLoadGrant.mockResolvedValue({
      credential_ciphertext: 'opaque-ciphertext',
      token_expires_at: '2026-04-01T10:00:00.000Z',
      refresh_token_expires_at: '2026-05-01T10:00:00.000Z',
      rotation_version: 3,
      client_key_hash: 'c'.repeat(64),
    });
    mockDecrypt.mockReturnValue({
      clientId: 'client-id',
      refreshToken: 'shared-refresh',
      accessToken: 'shared-access',
    });
    const supabase = createMockSupabase({
      data: {
        id: 'int-123',
        merchant_id: 'merchant-abc',
        shop_id: 'shop-456',
        country_code: 'NG',
        marketplace_key: 'default',
        access_token: null,
        refresh_token: null,
        token_expires_at: null,
        connection_method: 'self_authorization',
        jumia_authorization_id: 'auth-1',
      },
      error: null,
    });
    const credentialClient = { credential: true };

    await loadJumiaIntegrationConfig(supabase, 'merchant-abc', 'int-123', {
      credentialClient: credentialClient as never,
    });

    expect(mockLoadGrant).toHaveBeenCalledWith(
      credentialClient,
      'auth-1',
      'merchant-abc'
    );
  });

  it('throws when the self-authorization grant is unavailable', async () => {
    const { getJumiaAuthorizationEncryptionKey } = await import('@/env');
    vi.mocked(getJumiaAuthorizationEncryptionKey).mockReturnValue('test-key');
    mockLoadGrant.mockRejectedValue(
      new JumiaApiError(404, 'Jumia authorization grant not found')
    );
    const supabase = createMockSupabase({
      data: {
        id: 'int-123',
        merchant_id: 'merchant-abc',
        shop_id: 'shop-456',
        country_code: 'NG',
        marketplace_key: 'default',
        access_token: null,
        refresh_token: null,
        token_expires_at: null,
        connection_method: 'self_authorization',
        jumia_authorization_id: 'auth-1',
      },
      error: null,
    });

    await expect(
      loadJumiaIntegrationConfig(supabase, 'merchant-abc', 'int-123')
    ).rejects.toThrow(
      /Jumia API Error \(404\): Jumia authorization grant not found/
    );
  });
});
