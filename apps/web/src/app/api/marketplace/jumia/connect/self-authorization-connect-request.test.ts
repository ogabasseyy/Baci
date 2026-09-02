import { NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { jumiaAuthorizationCrypto } from '@/lib/jumia/authorization-crypto';
import { findJumiaAuthorizationMetadata } from '@/lib/jumia/find-jumia-authorization-metadata';
import { validateJumiaSelfAuthorization } from '@/lib/jumia/self-authorization';
import {
  claimJumiaSelfAuthorizationDiscovery,
  consumeJumiaSelfAuthorizationDiscovery,
  createJumiaSelfAuthorizationDiscovery,
  preserveJumiaSelfAuthorizationDiscoveryAfterRotation,
  releaseJumiaSelfAuthorizationDiscovery,
  updateClaimedJumiaSelfAuthorizationDiscovery,
} from '@/lib/jumia/self-authorization-discovery-store';
import { claimJumiaResumedAuthorization } from './claim-jumia-resumed-authorization';
import { handleJumiaSelfAuthorizationConnectRequest } from './self-authorization-connect-request';
import { jumiaSelfAuthorizationHandler } from './self-authorization-handler';

const { mockCreateAdminClient } = vi.hoisted(() => ({
  mockCreateAdminClient: vi.fn(),
}));

vi.mock('@/lib/jumia/self-authorization', () => ({
  validateJumiaSelfAuthorization: vi.fn(),
}));

vi.mock('@/lib/jumia/find-jumia-authorization-metadata', () => ({
  findJumiaAuthorizationMetadata: vi.fn(),
}));

vi.mock('./claim-jumia-resumed-authorization', () => ({
  claimJumiaResumedAuthorization: vi.fn(),
}));

vi.mock('@/lib/jumia/self-authorization-discovery-store', () => ({
  createJumiaSelfAuthorizationDiscovery: vi.fn(),
  loadJumiaSelfAuthorizationDiscovery: vi.fn(),
  claimJumiaSelfAuthorizationDiscovery: vi.fn(),
  consumeJumiaSelfAuthorizationDiscovery: vi.fn(),
  releaseJumiaSelfAuthorizationDiscovery: vi.fn(),
  preserveJumiaSelfAuthorizationDiscoveryAfterRotation: vi.fn(),
  updateClaimedJumiaSelfAuthorizationDiscovery: vi.fn(),
}));

vi.mock('@/lib/jumia/authorization-crypto', () => ({
  jumiaAuthorizationCrypto: {
    encrypt: vi.fn(() => 'ciphertext'),
    decrypt: vi.fn(() => ({
      clientId: 'client-1',
      refreshToken: 'refresh-1',
      accessToken: 'access-1',
    })),
    buildAuthorizationContext: vi.fn(
      (merchantId: string, clientKeyHash: string) =>
        `${merchantId}:${clientKeyHash}`
    ),
  },
}));

vi.mock('./self-authorization-handler', () => ({
  jumiaSelfAuthorizationHandler: {
    discover: vi.fn(async () => Response.json({ shops: [] })),
    connect: vi.fn(async () => Response.json({ connected: [] })),
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: mockCreateAdminClient,
}));

function buildSupabase(
  existing: unknown[] = [],
  authorizations: unknown[] = []
) {
  return {
    from: vi.fn((table: string) => {
      const rows = table === 'jumia_authorizations' ? authorizations : existing;
      const query = {
        eq: vi.fn(),
      } as {
        eq: ReturnType<typeof vi.fn>;
      };
      let eqCalls = 0;
      const requiredEqCalls = table === 'jumia_authorizations' ? 2 : 3;
      query.eq.mockImplementation(() => {
        eqCalls += 1;
        return eqCalls >= requiredEqCalls
          ? Promise.resolve({ data: rows, error: null })
          : query;
      });
      return {
        select: vi.fn(() => query),
      };
    }),
    rpc: vi.fn(),
  } as never;
}

describe('handleJumiaSelfAuthorizationConnectRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(findJumiaAuthorizationMetadata).mockResolvedValue([]);
    vi.mocked(claimJumiaResumedAuthorization).mockResolvedValue(null);
    vi.mocked(
      preserveJumiaSelfAuthorizationDiscoveryAfterRotation
    ).mockImplementation(async (supabase, args) => {
      if (args.discoveryId && args.claimToken) {
        try {
          await updateClaimedJumiaSelfAuthorizationDiscovery(supabase, {
            discoveryId: args.discoveryId,
            merchantId: args.merchantId,
            claimToken: args.claimToken,
            credentialCiphertext: args.credentialCiphertext,
          });
          return null;
        } catch {
          // Keep the route test's store mock aligned with the real fallback.
        }
      }
      return createJumiaSelfAuthorizationDiscovery(supabase, {
        merchantId: args.merchantId,
        clientKeyHash: args.clientKeyHash,
        credentialCiphertext: args.credentialCiphertext,
      });
    });
  });

  it('returns 400 when a selection request is missing discoveryId', async () => {
    const response = await handleJumiaSelfAuthorizationConnectRequest({
      body: {
        connectionType: 'self_authorization',
        clientId: 'client-1',
        selectedShopIds: ['shop-1'],
      } as never,
      encryptionKey: 'a'.repeat(44),
      merchantId: '00000000-0000-4000-8000-000000000001',
      supabase: {
        from: vi.fn(),
        rpc: vi.fn(),
      } as never,
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Invalid input',
    });
  });

  it('scopes single-marketplace self-authorizations to shop:country during discovery', async () => {
    vi.mocked(validateJumiaSelfAuthorization).mockResolvedValue({
      credentials: {
        clientId: 'client-1',
        refreshToken: 'refresh-1',
        accessToken: 'access-1',
      },
      accessTokenExpiresAt: '2026-03-27T10:00:00.000Z',
      refreshTokenExpiresAt: '2026-04-27T10:00:00.000Z',
      shops: [],
    });
    vi.mocked(createJumiaSelfAuthorizationDiscovery).mockResolvedValue(
      'discovery-1'
    );

    await handleJumiaSelfAuthorizationConnectRequest({
      body: {
        connectionType: 'self_authorization',
        operation: 'discover',
        clientId: 'client-1',
        refreshToken: 'refresh-1',
      },
      encryptionKey: 'a'.repeat(44),
      merchantId: '00000000-0000-4000-8000-000000000001',
      supabase: buildSupabase([
        {
          shop_id: 'shop-1',
          country_code: 'NG',
          marketplace_key: 'default',
          connection_method: 'self_authorization',
        },
      ]),
    });

    expect(jumiaSelfAuthorizationHandler.discover).toHaveBeenCalledWith(
      expect.objectContaining({
        existingShopIds: new Set(['shop-1:NG']),
      })
    );
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
  });

  it('returns the recovery discovery ID when shop discovery fails after token rotation', async () => {
    vi.mocked(validateJumiaSelfAuthorization).mockImplementation(
      async (_credentials, options) => {
        await options?.onCredentialsRotated?.({
          credentials: {
            clientId: 'client-1',
            refreshToken: 'rotated-refresh',
            accessToken: 'access-1',
          },
          accessTokenExpiresAt: '2026-03-27T10:00:00.000Z',
          refreshTokenExpiresAt: '2026-04-27T10:00:00.000Z',
        });
        throw new Error('Jumia shop discovery failed');
      }
    );
    vi.mocked(createJumiaSelfAuthorizationDiscovery).mockResolvedValue(
      '00000000-0000-4000-8000-000000000099'
    );
    vi.mocked(findJumiaAuthorizationMetadata).mockResolvedValue([
      {
        id: 'auth-1',
        token_expires_at: '2026-03-27T10:00:00.000Z',
        refresh_token_expires_at: '2026-04-27T10:00:00.000Z',
        rotation_version: 1,
      },
    ]);
    const supabase = buildSupabase(
      [
        {
          shop_id: 'shop-1',
          country_code: 'NG',
          marketplace_key: 'NG-RETAIL',
          connection_method: 'self_authorization',
          jumia_authorization_id: 'auth-1',
        },
      ],
      [{ id: 'auth-1', rotation_version: 1 }]
    ) as { rpc: ReturnType<typeof vi.fn> };
    supabase.rpc.mockResolvedValue({ data: [], error: null });

    const response = await handleJumiaSelfAuthorizationConnectRequest({
      body: {
        connectionType: 'self_authorization',
        operation: 'discover',
        clientId: 'client-1',
        refreshToken: 'refresh-1',
      },
      encryptionKey: 'a'.repeat(44),
      merchantId: '00000000-0000-4000-8000-000000000001',
      supabase: supabase as never,
    });

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: 'Jumia shop discovery failed',
      discoveryId: '00000000-0000-4000-8000-000000000099',
      retryable: true,
    });
    expect(supabase.rpc).toHaveBeenCalledWith(
      'persist_jumia_self_authorization_ordered',
      expect.objectContaining({
        p_credential_ciphertext: 'ciphertext',
        p_token_expires_at: '2026-03-27T10:00:00.000Z',
      })
    );
  });

  it('creates a recovery discovery when a claimed discovery cannot be updated after rotation', async () => {
    vi.mocked(claimJumiaSelfAuthorizationDiscovery).mockResolvedValueOnce({
      claimToken: 'claim-1',
      credentialCiphertext: 'ciphertext',
    });
    vi.mocked(
      updateClaimedJumiaSelfAuthorizationDiscovery
    ).mockRejectedValueOnce(new Error('discovery update unavailable'));
    vi.mocked(createJumiaSelfAuthorizationDiscovery).mockResolvedValueOnce(
      'fallback-discovery'
    );
    vi.mocked(validateJumiaSelfAuthorization).mockImplementationOnce(
      async (_credentials, options) => {
        await options?.onCredentialsRotated?.({
          credentials: {
            clientId: 'client-1',
            refreshToken: 'rotated-refresh',
            accessToken: 'access-1',
          },
          accessTokenExpiresAt: '2026-03-27T10:00:00.000Z',
          refreshTokenExpiresAt: '2026-04-27T10:00:00.000Z',
        });
        throw new Error('Jumia shop discovery failed');
      }
    );

    const response = await handleJumiaSelfAuthorizationConnectRequest({
      body: {
        connectionType: 'self_authorization',
        operation: 'discover',
        clientId: 'client-1',
        discoveryId: '00000000-0000-4000-8000-000000000099',
      },
      encryptionKey: 'a'.repeat(44),
      merchantId: '00000000-0000-4000-8000-000000000001',
      supabase: buildSupabase(),
    });

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: 'Jumia shop discovery failed',
      discoveryId: 'fallback-discovery',
      retryable: true,
    });
    expect(updateClaimedJumiaSelfAuthorizationDiscovery).toHaveBeenCalled();
    expect(createJumiaSelfAuthorizationDiscovery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ credentialCiphertext: 'ciphertext' })
    );
    expect(releaseJumiaSelfAuthorizationDiscovery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        discoveryId: '00000000-0000-4000-8000-000000000099',
        claimToken: 'claim-1',
      })
    );
  });

  it('persists rotated credentials to an existing self-authorization grant', async () => {
    vi.mocked(validateJumiaSelfAuthorization).mockImplementation(
      async (_credentials, options) => {
        await options?.onCredentialsRotated?.({
          credentials: {
            clientId: 'client-1',
            refreshToken: 'rotated-refresh',
            accessToken: 'access-1',
          },
          accessTokenExpiresAt: '2026-03-27T10:00:00.000Z',
          refreshTokenExpiresAt: '2026-04-27T10:00:00.000Z',
        });
        return {
          credentials: {
            clientId: 'client-1',
            refreshToken: 'rotated-refresh',
            accessToken: 'access-1',
          },
          accessTokenExpiresAt: '2026-03-27T10:00:00.000Z',
          refreshTokenExpiresAt: '2026-04-27T10:00:00.000Z',
          shops: [],
        };
      }
    );
    vi.mocked(createJumiaSelfAuthorizationDiscovery).mockResolvedValue(
      'discovery-rotated'
    );
    vi.mocked(findJumiaAuthorizationMetadata).mockResolvedValue([
      {
        id: 'auth-1',
        token_expires_at: '2026-03-27T10:00:00.000Z',
        refresh_token_expires_at: '2026-04-27T10:00:00.000Z',
        rotation_version: 1,
      },
    ]);
    const supabase = buildSupabase(
      [
        {
          shop_id: 'shop-1',
          country_code: 'NG',
          marketplace_key: 'NG-RETAIL',
          connection_method: 'self_authorization',
          jumia_authorization_id: 'auth-1',
        },
      ],
      [{ id: 'auth-1', rotation_version: 1 }]
    ) as { rpc: ReturnType<typeof vi.fn> };
    supabase.rpc.mockResolvedValue({ data: [], error: null });

    const response = await handleJumiaSelfAuthorizationConnectRequest({
      body: {
        connectionType: 'self_authorization',
        operation: 'discover',
        clientId: 'client-1',
        refreshToken: 'refresh-1',
      },
      encryptionKey: 'a'.repeat(44),
      merchantId: '00000000-0000-4000-8000-000000000001',
      supabase: supabase as never,
    });

    expect(response.status).toBe(200);
    expect(supabase.rpc).toHaveBeenCalledWith(
      'persist_jumia_self_authorization_ordered',
      expect.objectContaining({
        p_shop_ids: ['shop-1'],
        p_business_client_codes: ['NG-RETAIL'],
        p_token_expires_at: '2026-03-27T10:00:00.000Z',
      })
    );
  });

  it('resumes discovery with the credentials behind a recovery ID', async () => {
    vi.mocked(claimJumiaSelfAuthorizationDiscovery).mockResolvedValue({
      claimToken: 'claim-1',
      credentialCiphertext: 'ciphertext',
    });
    vi.mocked(validateJumiaSelfAuthorization).mockResolvedValue({
      credentials: {
        clientId: 'client-1',
        refreshToken: 'rotated-refresh',
        accessToken: 'access-1',
      },
      accessTokenExpiresAt: '2026-03-27T10:00:00.000Z',
      refreshTokenExpiresAt: '2026-04-27T10:00:00.000Z',
      shops: [],
    });

    const response = await handleJumiaSelfAuthorizationConnectRequest({
      body: {
        connectionType: 'self_authorization',
        operation: 'discover',
        clientId: 'client-1',
        discoveryId: '00000000-0000-4000-8000-000000000099',
      },
      encryptionKey: 'a'.repeat(44),
      merchantId: '00000000-0000-4000-8000-000000000001',
      supabase: buildSupabase(),
    });

    expect(response.ok).toBe(true);
    expect(validateJumiaSelfAuthorization).toHaveBeenCalledWith(
      expect.objectContaining({ refreshToken: 'refresh-1' }),
      expect.any(Object)
    );
    expect(releaseJumiaSelfAuthorizationDiscovery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        discoveryId: '00000000-0000-4000-8000-000000000099',
        claimToken: 'claim-1',
      })
    );
  });

  it('uses fresh credentials when replacing a resumed discovery', async () => {
    vi.mocked(validateJumiaSelfAuthorization).mockResolvedValue({
      credentials: {
        clientId: 'client-1',
        refreshToken: 'fresh-refresh',
        accessToken: 'access-1',
      },
      accessTokenExpiresAt: '2026-03-27T10:00:00.000Z',
      refreshTokenExpiresAt: '2026-04-27T10:00:00.000Z',
      shops: [],
    });
    vi.mocked(createJumiaSelfAuthorizationDiscovery).mockResolvedValue(
      'replacement-discovery'
    );

    const response = await handleJumiaSelfAuthorizationConnectRequest({
      body: {
        connectionType: 'self_authorization',
        operation: 'discover',
        clientId: 'client-1',
        refreshToken: 'fresh-refresh',
        discoveryId: '00000000-0000-4000-8000-000000000099',
      },
      encryptionKey: 'a'.repeat(44),
      merchantId: '00000000-0000-4000-8000-000000000001',
      supabase: buildSupabase(),
    });

    expect(response.status).toBe(200);
    expect(validateJumiaSelfAuthorization).toHaveBeenCalledWith(
      { clientId: 'client-1', refreshToken: 'fresh-refresh' },
      expect.any(Object)
    );
    expect(claimJumiaSelfAuthorizationDiscovery).not.toHaveBeenCalled();
    expect(claimJumiaResumedAuthorization).not.toHaveBeenCalled();
    expect(createJumiaSelfAuthorizationDiscovery).toHaveBeenCalled();
  });

  it('releases a discovery claim when its credentials cannot be decrypted', async () => {
    vi.mocked(claimJumiaSelfAuthorizationDiscovery).mockResolvedValueOnce({
      claimToken: 'claim-1',
      credentialCiphertext: 'ciphertext',
    });
    vi.mocked(jumiaAuthorizationCrypto.decrypt).mockImplementationOnce(() => {
      throw new Error('invalid discovery ciphertext');
    });

    await expect(
      handleJumiaSelfAuthorizationConnectRequest({
        body: {
          connectionType: 'self_authorization',
          discoveryId: '00000000-0000-4000-8000-000000000099',
          clientId: 'client-1',
          selectedShopIds: ['shop-1'],
        },
        encryptionKey: 'a'.repeat(44),
        merchantId: '00000000-0000-4000-8000-000000000001',
        supabase: buildSupabase(),
      })
    ).rejects.toThrow('invalid discovery ciphertext');

    expect(releaseJumiaSelfAuthorizationDiscovery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        discoveryId: '00000000-0000-4000-8000-000000000099',
        claimToken: 'claim-1',
      })
    );
  });

  it('consumes discovery credentials only after a successful connect', async () => {
    vi.mocked(claimJumiaSelfAuthorizationDiscovery).mockResolvedValue({
      claimToken: '00000000-0000-4000-8000-000000000088',
      credentialCiphertext: 'ciphertext',
    });
    vi.mocked(consumeJumiaSelfAuthorizationDiscovery).mockResolvedValue(
      'ciphertext'
    );
    vi.mocked(jumiaSelfAuthorizationHandler.connect).mockResolvedValue(
      NextResponse.json({ connected: ['shop-1'] })
    );

    const response = await handleJumiaSelfAuthorizationConnectRequest({
      body: {
        connectionType: 'self_authorization',
        discoveryId: '00000000-0000-4000-8000-000000000099',
        clientId: 'client-1',
        selectedShopIds: ['shop-1'],
      },
      encryptionKey: 'a'.repeat(44),
      merchantId: '00000000-0000-4000-8000-000000000001',
      supabase: buildSupabase(),
    });

    expect(response.ok).toBe(true);
    expect(claimJumiaSelfAuthorizationDiscovery).toHaveBeenCalled();
    expect(consumeJumiaSelfAuthorizationDiscovery).toHaveBeenCalled();
  });

  it('returns the successful connect response when discovery cleanup fails transiently', async () => {
    vi.mocked(claimJumiaSelfAuthorizationDiscovery).mockResolvedValue({
      claimToken: '00000000-0000-4000-8000-000000000088',
      credentialCiphertext: 'ciphertext',
    });
    vi.mocked(consumeJumiaSelfAuthorizationDiscovery).mockRejectedValue(
      new Error('discovery cleanup unavailable')
    );
    vi.mocked(jumiaSelfAuthorizationHandler.connect).mockResolvedValue(
      NextResponse.json({ connected: ['shop-1'] })
    );

    const response = await handleJumiaSelfAuthorizationConnectRequest({
      body: {
        connectionType: 'self_authorization',
        discoveryId: '00000000-0000-4000-8000-000000000099',
        clientId: 'client-1',
        selectedShopIds: ['shop-1'],
      },
      encryptionKey: 'a'.repeat(44),
      merchantId: '00000000-0000-4000-8000-000000000001',
      supabase: buildSupabase(),
    });

    expect(response.ok).toBe(true);
    await expect(response.json()).resolves.toEqual({
      connected: ['shop-1'],
    });
    expect(consumeJumiaSelfAuthorizationDiscovery).toHaveBeenCalled();
  });

  it('keeps discovery credentials when connect fails after token rotation', async () => {
    vi.mocked(claimJumiaSelfAuthorizationDiscovery).mockResolvedValue({
      claimToken: '00000000-0000-4000-8000-000000000088',
      credentialCiphertext: 'ciphertext',
    });
    vi.mocked(jumiaSelfAuthorizationHandler.connect).mockResolvedValue(
      NextResponse.json({ error: 'Shop discovery failed' }, { status: 502 })
    );

    const response = await handleJumiaSelfAuthorizationConnectRequest({
      body: {
        connectionType: 'self_authorization',
        discoveryId: '00000000-0000-4000-8000-000000000099',
        clientId: 'client-1',
        selectedShopIds: ['shop-1'],
      },
      encryptionKey: 'a'.repeat(44),
      merchantId: '00000000-0000-4000-8000-000000000001',
      supabase: buildSupabase(),
    });

    expect(response.status).toBe(502);
    expect(consumeJumiaSelfAuthorizationDiscovery).not.toHaveBeenCalled();
    expect(releaseJumiaSelfAuthorizationDiscovery).toHaveBeenCalled();
  });

  it('claims discovery before rotation and preserves rotated credentials under the claim', async () => {
    vi.mocked(claimJumiaSelfAuthorizationDiscovery).mockResolvedValue({
      claimToken: '00000000-0000-4000-8000-000000000088',
      credentialCiphertext: 'ciphertext',
    });
    vi.mocked(claimJumiaResumedAuthorization).mockResolvedValue({
      credentials: {
        clientId: 'client-1',
        refreshToken: 'refresh-1',
      },
      authorizationId: 'auth-1',
      authorizationRotationVersion: 1,
      leaseToken: 'lease-1',
    });
    vi.mocked(validateJumiaSelfAuthorization).mockImplementationOnce(
      async (_credentials, options) => {
        await options?.onCredentialsRotated?.({
          credentials: {
            clientId: 'client-1',
            refreshToken: 'refresh-2',
            accessToken: 'access-2',
          },
          accessTokenExpiresAt: '2026-03-27T10:00:00.000Z',
          refreshTokenExpiresAt: '2026-04-27T10:00:00.000Z',
        });
        return {
          credentials: {
            clientId: 'client-1',
            refreshToken: 'refresh-2',
            accessToken: 'access-2',
          },
          accessTokenExpiresAt: '2026-03-27T10:00:00.000Z',
          refreshTokenExpiresAt: '2026-04-27T10:00:00.000Z',
          shops: [],
        };
      }
    );
    vi.mocked(jumiaSelfAuthorizationHandler.connect).mockImplementationOnce(
      async (args) => {
        await args.validate({
          clientId: 'client-1',
          refreshToken: 'refresh-1',
        });
        return NextResponse.json(
          { error: 'Shop discovery failed' },
          { status: 502 }
        );
      }
    );

    const supabase = buildSupabase(
      [
        {
          shop_id: 'shop-1',
          country_code: 'NG',
          marketplace_key: 'NG-RETAIL',
          connection_method: 'self_authorization',
          jumia_authorization_id: 'auth-1',
        },
      ],
      [{ id: 'auth-1', rotation_version: 1 }]
    ) as { rpc: ReturnType<typeof vi.fn> };
    supabase.rpc.mockImplementation((name: string) =>
      Promise.resolve({
        data: name === 'rotate_jumia_authorization_credentials' ? 2 : [],
        error: null,
      })
    );

    const response = await handleJumiaSelfAuthorizationConnectRequest({
      body: {
        connectionType: 'self_authorization',
        discoveryId: '00000000-0000-4000-8000-000000000099',
        clientId: 'client-1',
        selectedShopIds: ['shop-1'],
      },
      encryptionKey: 'a'.repeat(44),
      merchantId: '00000000-0000-4000-8000-000000000001',
      supabase: supabase as never,
    });

    expect(response.status).toBe(502);
    expect(updateClaimedJumiaSelfAuthorizationDiscovery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        claimToken: '00000000-0000-4000-8000-000000000088',
        credentialCiphertext: 'ciphertext',
      })
    );
    expect(supabase.rpc).toHaveBeenCalledWith(
      'rotate_jumia_authorization_credentials',
      expect.objectContaining({
        p_authorization_id: 'auth-1',
        p_expected_rotation_version: 1,
        p_refresh_lease_token: 'lease-1',
      })
    );
    expect(releaseJumiaSelfAuthorizationDiscovery).toHaveBeenCalled();
  });

  it('returns a recovery discovery when selection rotation cannot update its claim', async () => {
    vi.mocked(
      updateClaimedJumiaSelfAuthorizationDiscovery
    ).mockRejectedValueOnce(new Error('discovery update unavailable'));
    vi.mocked(createJumiaSelfAuthorizationDiscovery).mockResolvedValueOnce(
      'fallback-discovery'
    );
    vi.mocked(claimJumiaSelfAuthorizationDiscovery).mockResolvedValueOnce({
      claimToken: 'claim-1',
      credentialCiphertext: 'ciphertext',
    });
    vi.mocked(claimJumiaResumedAuthorization).mockResolvedValueOnce({
      credentials: {
        clientId: 'client-1',
        refreshToken: 'refresh-1',
      },
      authorizationId: 'auth-1',
      authorizationRotationVersion: 1,
      leaseToken: 'lease-1',
    });
    vi.mocked(validateJumiaSelfAuthorization).mockImplementationOnce(
      async (_credentials, options) => {
        await options?.onCredentialsRotated?.({
          credentials: {
            clientId: 'client-1',
            refreshToken: 'rotated-refresh',
            accessToken: 'access-1',
          },
          accessTokenExpiresAt: '2026-03-27T10:00:00.000Z',
          refreshTokenExpiresAt: '2026-04-27T10:00:00.000Z',
        });
        return {
          credentials: {
            clientId: 'client-1',
            refreshToken: 'rotated-refresh',
            accessToken: 'access-1',
          },
          accessTokenExpiresAt: '2026-03-27T10:00:00.000Z',
          refreshTokenExpiresAt: '2026-04-27T10:00:00.000Z',
          shops: [],
        };
      }
    );
    vi.mocked(jumiaSelfAuthorizationHandler.connect).mockImplementationOnce(
      async (args) => {
        await args.validate({
          clientId: 'client-1',
          refreshToken: 'refresh-1',
        });
        return NextResponse.json(
          { error: 'Jumia connection failed' },
          { status: 502 }
        );
      }
    );

    const supabase = buildSupabase() as { rpc: ReturnType<typeof vi.fn> };
    supabase.rpc.mockResolvedValue({ data: 2, error: null });

    const response = await handleJumiaSelfAuthorizationConnectRequest({
      body: {
        connectionType: 'self_authorization',
        discoveryId: '00000000-0000-4000-8000-000000000099',
        clientId: 'client-1',
        selectedShopIds: ['shop-1'],
      },
      encryptionKey: 'a'.repeat(44),
      merchantId: '00000000-0000-4000-8000-000000000001',
      supabase: supabase as never,
    });

    expect(response.status).toBe(502);
    expect(response.headers.get('x-jumia-discovery-id')).toBe(
      'fallback-discovery'
    );
    expect(
      preserveJumiaSelfAuthorizationDiscoveryAfterRotation
    ).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        discoveryId: '00000000-0000-4000-8000-000000000099',
        clientKeyHash: expect.any(String),
        credentialCiphertext: 'ciphertext',
      })
    );
  });
});
