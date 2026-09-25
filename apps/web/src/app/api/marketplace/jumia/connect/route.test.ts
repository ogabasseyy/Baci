import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const PUBLIC_APP_URL = 'https://example.com/';
const PUBLIC_CALLBACK_URL =
  'https://example.com/api/marketplace/jumia/callback';

const mockGetUser = vi.fn();
const mockUpsert = vi.fn();
const mockSelect = vi.fn().mockReturnValue({ single: vi.fn() });
const mockGetMerchant = vi.fn();
const mockToUserAccess = vi.fn();
const { mockHasPermission } = vi.hoisted(() => ({
  mockHasPermission: vi.fn(
    (_access: unknown, _resource: string, _action: string) => true
  ),
}));
const mockAuthenticateApiRequest = vi.fn();
const mockFeaturePlanTier = vi.fn(() => 'pro');
const mockPurgeOrphanedAuthorization = vi.fn().mockResolvedValue(true);
const mockGetJumiaAuthUrl = vi
  .fn()
  .mockReturnValue('https://jumia.com/auth?state=xyz');
const { mockGetConfiguredAppUrl, mockGetJumiaRedirectUri } = vi.hoisted(() => {
  const getValidatedAppUrl = () => {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();

    if (!appUrl) {
      return null;
    }

    try {
      const parsedUrl = new URL(appUrl);
      const hostname = parsedUrl.hostname.toLowerCase();

      if (
        hostname === 'localhost' ||
        hostname === '0.0.0.0' ||
        hostname === '::1' ||
        hostname.startsWith('127.') ||
        hostname.endsWith('.localhost')
      ) {
        return null;
      }

      return appUrl;
    } catch {
      return null;
    }
  };

  return {
    mockGetConfiguredAppUrl: vi.fn(getValidatedAppUrl),
    mockGetJumiaRedirectUri: vi.fn((appUrl: string) => {
      const baseUrl = appUrl.replace(/\/+$/, '');
      return `${baseUrl}/api/marketplace/jumia/callback`;
    }),
  };
});

function createMarketplaceIntegrationsBuilder() {
  const thirdEq = vi.fn().mockResolvedValue({ data: [], error: null });
  const secondEq = vi.fn(() => ({ eq: thirdEq }));
  const firstEq = vi.fn(() => ({ eq: secondEq }));
  return {
    select: vi.fn(() => ({ eq: firstEq })),
  };
}

function createJumiaAuthorizationsBuilder() {
  const secondEq = vi.fn().mockResolvedValue({ data: [], error: null });
  const firstEq = vi.fn(() => ({ eq: secondEq }));
  return {
    select: vi.fn(() => ({ eq: firstEq })),
  };
}

function createUpsertBuilder() {
  return {
    upsert: (...args: unknown[]) => {
      mockUpsert(...args);
      return { select: () => mockSelect() };
    },
  };
}

function createMerchantFeatureBuilder() {
  return {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        single: vi.fn().mockResolvedValue({
          data: {
            id: MERCHANT_CTX.merchantId,
            plan_expires_at: null,
            plan_tier: mockFeaturePlanTier(),
            premium_features: [],
          },
          error: null,
        }),
      })),
    })),
  };
}

const mockSupabase = {
  auth: { getUser: mockGetUser },
  rpc: vi.fn().mockResolvedValue({
    data: [
      {
        authorization_id: 'auth-1',
        integration_id: 'integration-1',
        shop_id: 'shop-1',
        inserted: true,
      },
    ],
    error: null,
  }),
  from: vi.fn<(...args: unknown[]) => unknown>((table) => {
    if (table === 'merchants') {
      return createMerchantFeatureBuilder();
    }
    if (table === 'marketplace_integrations') {
      return createMarketplaceIntegrationsBuilder();
    }
    if (table === 'jumia_authorizations') {
      return createJumiaAuthorizationsBuilder();
    }
    return createUpsertBuilder();
  }),
};

vi.mock('next/headers', () => ({ cookies: vi.fn().mockResolvedValue({}) }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => mockSupabase),
}));

vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: vi.fn().mockResolvedValue({ valid: true }),
}));

vi.mock('@/lib/jumia/purge-orphaned-jumia-authorization', () => ({
  purgeOrphanedJumiaAuthorization: (...args: unknown[]) =>
    mockPurgeOrphanedAuthorization(...args),
}));

vi.mock('@/lib/get-merchant-for-api-request', () => ({
  getMerchantForApiRequest: (...args: unknown[]) => mockGetMerchant(...args),
  toUserAccess: (...args: unknown[]) => mockToUserAccess(...args),
}));

vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: (...args: unknown[]) =>
    mockAuthenticateApiRequest(...args),
  hasPermission: mockHasPermission,
}));

vi.mock('@/lib/jumia/helpers', async () => {
  const actual = await vi.importActual<typeof import('@/lib/jumia/helpers')>(
    '@/lib/jumia/helpers'
  );
  return {
    ...actual,
    getJumiaAuthUrl: (...args: unknown[]) => mockGetJumiaAuthUrl(...args),
    getJumiaRedirectUri: (appUrl: string) => mockGetJumiaRedirectUri(appUrl),
    isJumiaAuthUrlVariant: (value: string | null | undefined) =>
      value === 'A' ||
      value === 'B' ||
      value === 'C' ||
      value === 'D' ||
      value === 'E',
  };
});

vi.mock('@/lib/jumia/self-authorization', () => ({
  validateJumiaSelfAuthorization: vi.fn().mockResolvedValue({
    credentials: {
      clientId: 'client-1',
      refreshToken: 'refresh-1',
      accessToken: 'access-1',
    },
    accessTokenExpiresAt: '2030-01-01T00:00:00.000Z',
    refreshTokenExpiresAt: '2030-02-01T00:00:00.000Z',
    shops: [
      {
        id: 'shop-1',
        name: 'My Jumia Shop',
        countryCode: 'NG',
        marketplace: 'Jumia',
      },
    ],
  }),
}));

vi.mock('@/lib/jumia/self-authorization-discovery-store', () => ({
  claimJumiaSelfAuthorizationDiscovery: vi.fn().mockResolvedValue({
    claimToken: 'claim-token-1',
    credentialCiphertext: 'ciphertext',
  }),
  createJumiaSelfAuthorizationDiscovery: vi
    .fn()
    .mockResolvedValue('00000000-0000-4000-8000-000000000099'),
  loadJumiaSelfAuthorizationDiscovery: vi.fn().mockResolvedValue('ciphertext'),
  consumeJumiaSelfAuthorizationDiscovery: vi
    .fn()
    .mockResolvedValue('ciphertext'),
  releaseJumiaSelfAuthorizationDiscovery: vi.fn().mockResolvedValue(undefined),
  updateClaimedJumiaSelfAuthorizationDiscovery: vi
    .fn()
    .mockResolvedValue(undefined),
}));

const { mockDecrypt } = vi.hoisted(() => ({
  mockDecrypt: vi.fn(() => ({
    clientId: 'client-1',
    refreshToken: 'refresh-1',
    accessToken: 'access-1',
  })),
}));

vi.mock('@/lib/jumia/authorization-crypto', () => ({
  jumiaAuthorizationCrypto: {
    encrypt: vi.fn(() => 'ciphertext'),
    decrypt: mockDecrypt,
    buildAuthorizationContext: vi.fn(
      (merchantId: string, clientKeyHash: string) =>
        `${merchantId}:${clientKeyHash}`
    ),
  },
}));

vi.mock('@/env', () => ({
  getConfiguredAppUrl: mockGetConfiguredAppUrl,
  getJumiaClientId: vi.fn(() => process.env.JUMIA_CLIENT_ID),
  getJumiaAuthorizationEncryptionKey: vi.fn(() => 'a'.repeat(44)),
}));

const MERCHANT_CTX = {
  merchantId: '00000000-0000-4000-8000-000000000001',
  staffAccess: {
    role: 'owner',
    isOwner: true,
    isStaff: false,
    permissions: {},
  },
};
const INTEGRATION_ID = '00000000-0000-4000-8000-000000000010';
const OTHER_INTEGRATION_ID = '00000000-0000-4000-8000-000000000011';

function makePostRequest(body: unknown, cookie?: string) {
  return new NextRequest('http://localhost/api/marketplace/jumia/connect', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
  });
}

function makeGetRequest(search = '') {
  return new NextRequest(
    `http://localhost/api/marketplace/jumia/connect${search}`
  );
}

function makeBearerGetRequest(search = '') {
  return new NextRequest(
    `http://localhost/api/marketplace/jumia/connect${search}`,
    {
      headers: {
        Authorization: 'Bearer test-token',
      },
    }
  );
}

function makeBearerDeleteRequest(search = '') {
  return new NextRequest(
    `http://localhost/api/marketplace/jumia/connect${search}`,
    {
      method: 'DELETE',
      headers: {
        Authorization: 'Bearer test-token',
      },
    }
  );
}

function setupAuth() {
  mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
  mockGetMerchant.mockResolvedValue(MERCHANT_CTX);
  mockToUserAccess.mockReturnValue({
    merchantId: MERCHANT_CTX.merchantId,
    role: 'owner',
    isOwner: true,
    isStaff: false,
    permissions: {},
  });
}

import {
  consumeJumiaSelfAuthorizationDiscovery,
  createJumiaSelfAuthorizationDiscovery,
} from '@/lib/jumia/self-authorization-discovery-store';
import { DELETE, GET, POST } from './route';

const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;
const originalJumiaClientId = process.env.JUMIA_CLIENT_ID;

function restoreEnv() {
  if (originalAppUrl === undefined) {
    delete process.env.NEXT_PUBLIC_APP_URL;
  } else {
    process.env.NEXT_PUBLIC_APP_URL = originalAppUrl;
  }

  if (originalJumiaClientId === undefined) {
    delete process.env.JUMIA_CLIENT_ID;
  } else {
    process.env.JUMIA_CLIENT_ID = originalJumiaClientId;
  }
}

describe('Connect POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReset();
    mockHasPermission.mockReturnValue(true);
    process.env.NEXT_PUBLIC_APP_URL = PUBLIC_APP_URL;
    process.env.JUMIA_CLIENT_ID = 'test-client-id';
    mockSelect.mockReturnValue({ single: vi.fn() });
    mockFeaturePlanTier.mockReturnValue('pro');
    mockGetJumiaAuthUrl.mockReturnValue('https://jumia.com/auth?state=xyz');
    vi.mocked(createJumiaSelfAuthorizationDiscovery).mockResolvedValue(
      '00000000-0000-4000-8000-000000000099'
    );
    vi.mocked(consumeJumiaSelfAuthorizationDiscovery).mockResolvedValue(
      'ciphertext'
    );
    mockDecrypt.mockReturnValue({
      clientId: 'client-1',
      refreshToken: 'refresh-1',
      accessToken: 'access-1',
    });
  });

  afterEach(() => {
    restoreEnv();
  });

  it('returns 403 on CSRF failure', async () => {
    setupAuth();
    const { checkCsrfProtection } = await import('@/lib/csrf');
    (checkCsrfProtection as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      valid: false,
      response: null,
    });

    const res = await POST(makePostRequest({ connectionType: 'oauth' }));

    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toBeDefined();
  });

  it('returns 401 when unauthenticated', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'no' },
    });

    const res = await POST(
      makePostRequest({
        connectionType: 'self_authorization',
        refreshToken: 'tok',
      })
    );

    expect(res.status).toBe(401);
  });

  it('returns 404 when merchant not found', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'u1' } },
      error: null,
    });
    mockGetMerchant.mockResolvedValue(null);

    const res = await POST(
      makePostRequest({
        connectionType: 'self_authorization',
        operation: 'discover',
        clientId: 'client-1',
        refreshToken: 'tok',
      })
    );

    expect(res.status).toBe(404);
  });

  it('returns 403 when permission denied', async () => {
    setupAuth();
    const { hasPermission } = await import('@/lib/api-auth');
    (hasPermission as ReturnType<typeof vi.fn>).mockReturnValueOnce(false);

    const res = await POST(
      makePostRequest({
        connectionType: 'self_authorization',
        operation: 'discover',
        clientId: 'client-1',
        refreshToken: 'tok',
      })
    );

    expect(res.status).toBe(403);
  });

  it('returns 402 before saving an integration when marketplace sync is not enabled', async () => {
    setupAuth();
    mockFeaturePlanTier.mockReturnValue('free');
    mockSelect.mockReturnValue({
      single: vi.fn().mockResolvedValue({
        data: {
          id: INTEGRATION_ID,
          shop_id: 'default',
          shop_name: 'My Jumia Shop',
        },
        error: null,
      }),
    });

    const res = await POST(
      makePostRequest({
        connectionType: 'self_authorization',
        operation: 'discover',
        clientId: 'client-1',
        refreshToken: 'tok',
      })
    );

    expect(res.status).toBe(402);
    await expect(res.json()).resolves.toMatchObject({
      code: 'requires_upgrade',
      error: 'Marketplace sync requires Baci Pro',
    });
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid body', async () => {
    setupAuth();

    const res = await POST(
      makePostRequest({ connectionType: 'self_authorization' })
    );

    expect(res.status).toBe(400);
  });

  it('returns 503 when self-authorization encryption is not configured', async () => {
    setupAuth();
    const { getJumiaAuthorizationEncryptionKey } = await import('@/env');
    vi.mocked(getJumiaAuthorizationEncryptionKey).mockReturnValueOnce(
      undefined
    );

    const res = await POST(
      makePostRequest({
        connectionType: 'self_authorization',
        clientId: 'client-1',
        discoveryId: '00000000-0000-4000-8000-000000000099',
        selectedShopIds: ['shop-1'],
      })
    );

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({
      error: 'Jumia self-authorization is not configured',
    });
  });

  it('saves integration on self_authorization success', async () => {
    setupAuth();
    mockSelect.mockReturnValue({
      single: vi.fn().mockResolvedValue({
        data: {
          id: INTEGRATION_ID,
          shop_id: 'default',
          shop_name: 'My Jumia Shop',
        },
        error: null,
      }),
    });

    const res = await POST(
      makePostRequest({
        connectionType: 'self_authorization',
        clientId: 'client-1',
        discoveryId: '00000000-0000-4000-8000-000000000099',
        selectedShopIds: ['shop-1'],
      })
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.connected).toEqual([{ id: 'shop-1', name: 'My Jumia Shop' }]);
    expect(mockSupabase.rpc).toHaveBeenCalledWith(
      'persist_jumia_self_authorization_ordered',
      expect.objectContaining({ p_merchant_id: MERCHANT_CTX.merchantId })
    );
  });

  it('returns 500 on DB insert error', async () => {
    setupAuth();
    mockSupabase.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'unique violation' },
    });

    const res = await POST(
      makePostRequest({
        connectionType: 'self_authorization',
        clientId: 'client-1',
        discoveryId: '00000000-0000-4000-8000-000000000099',
        selectedShopIds: ['shop-1'],
      })
    );

    expect(res.status).toBe(500);
  });

  it('returns 500 for oauth when JUMIA_CLIENT_ID is not configured', async () => {
    setupAuth();
    delete process.env.JUMIA_CLIENT_ID;

    const res = await POST(makePostRequest({ connectionType: 'oauth' }));

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('Jumia OAuth not configured');
    expect(mockGetJumiaAuthUrl).not.toHaveBeenCalled();
  });

  it('returns 500 for oauth when NEXT_PUBLIC_APP_URL is not configured', async () => {
    setupAuth();
    delete process.env.NEXT_PUBLIC_APP_URL;

    const res = await POST(makePostRequest({ connectionType: 'oauth' }));

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('Jumia OAuth not configured');
    expect(mockGetJumiaAuthUrl).not.toHaveBeenCalled();
  });

  it('returns 500 for oauth when NEXT_PUBLIC_APP_URL is localhost', async () => {
    setupAuth();
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';

    const res = await POST(makePostRequest({ connectionType: 'oauth' }));

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('Jumia OAuth not configured');
    expect(mockGetConfiguredAppUrl).toHaveBeenCalled();
    expect(mockGetJumiaAuthUrl).not.toHaveBeenCalled();
  });

  it('returns 200 with auth URL when OAuth is configured', async () => {
    setupAuth();
    const res = await POST(makePostRequest({ connectionType: 'oauth' }));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.redirectUrl).toBe('https://jumia.com/auth?state=xyz');
    expect(mockGetJumiaRedirectUri).toHaveBeenCalledWith(PUBLIC_APP_URL);
    expect(mockGetJumiaAuthUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: 'test-client-id',
        redirectUri: PUBLIC_CALLBACK_URL,
      })
    );
  });
});

describe('Connect GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReset();
    mockHasPermission.mockReturnValue(true);
    process.env.NEXT_PUBLIC_APP_URL = PUBLIC_APP_URL;
    process.env.JUMIA_CLIENT_ID = 'test-client-id';
    mockFeaturePlanTier.mockReturnValue('pro');
    mockGetJumiaAuthUrl.mockReturnValue('https://jumia.com/auth?state=xyz');
    setupAuth();
    mockAuthenticateApiRequest.mockResolvedValue({
      user: { id: 'u1' },
      supabase: mockSupabase,
      error: null,
    });
  });

  afterEach(() => {
    restoreEnv();
  });

  it('returns 401 when unauthenticated', async () => {
    mockAuthenticateApiRequest.mockResolvedValue({
      user: null,
      supabase: null,
      error: 'no',
    });

    const res = await GET(makeGetRequest('?connectionType=oauth'));

    expect(res.status).toBe(401);
    expect(mockGetJumiaAuthUrl).not.toHaveBeenCalled();
  });

  it('returns 404 when merchant not found', async () => {
    mockGetMerchant.mockResolvedValue(null);

    const res = await GET(makeGetRequest('?connectionType=oauth'));

    expect(res.status).toBe(404);
    expect(mockGetJumiaAuthUrl).not.toHaveBeenCalled();
  });

  it('returns 403 when permission is denied', async () => {
    mockHasPermission.mockReturnValueOnce(false);

    const res = await GET(makeGetRequest('?connectionType=oauth'));

    expect(res.status).toBe(403);
    expect(mockGetJumiaAuthUrl).not.toHaveBeenCalled();
  });

  it('returns 403 before OAuth initiation when manage permission is missing', async () => {
    mockHasPermission.mockImplementation(
      (_access, _resource, action) => action === 'view'
    );

    const res = await GET(makeGetRequest('?connectionType=oauth'));

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: 'Forbidden' });
    expect(mockGetJumiaAuthUrl).not.toHaveBeenCalled();
  });

  it('returns 402 before redirecting to OAuth when marketplace sync is not enabled', async () => {
    mockFeaturePlanTier.mockReturnValue('free');

    const res = await GET(makeGetRequest('?connectionType=oauth'));

    expect(res.status).toBe(402);
    await expect(res.json()).resolves.toMatchObject({
      code: 'requires_upgrade',
      error: 'Marketplace sync requires Baci Pro',
    });
    expect(mockGetJumiaAuthUrl).not.toHaveBeenCalled();
  });

  it('returns 500 when JUMIA_CLIENT_ID is not configured', async () => {
    delete process.env.JUMIA_CLIENT_ID;

    const res = await GET(makeGetRequest('?connectionType=oauth'));

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('Jumia OAuth not configured');
    expect(mockGetJumiaAuthUrl).not.toHaveBeenCalled();
  });

  it('returns 500 for oauth when NEXT_PUBLIC_APP_URL is not configured', async () => {
    delete process.env.NEXT_PUBLIC_APP_URL;

    const res = await GET(makeGetRequest('?connectionType=oauth'));

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('Jumia OAuth not configured');
    expect(mockGetJumiaAuthUrl).not.toHaveBeenCalled();
  });

  it('returns 500 for oauth when NEXT_PUBLIC_APP_URL is malformed', async () => {
    process.env.NEXT_PUBLIC_APP_URL = 'not-a-url';

    const res = await GET(makeGetRequest('?connectionType=oauth'));

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('Jumia OAuth not configured');
    expect(mockGetConfiguredAppUrl).toHaveBeenCalled();
    expect(mockGetJumiaAuthUrl).not.toHaveBeenCalled();
  });

  it('returns 500 for oauth when NEXT_PUBLIC_APP_URL is localhost', async () => {
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';

    const res = await GET(makeGetRequest('?connectionType=oauth'));

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('Jumia OAuth not configured');
    expect(mockGetConfiguredAppUrl).toHaveBeenCalled();
    expect(mockGetJumiaAuthUrl).not.toHaveBeenCalled();
  });

  it('redirects to Jumia when OAuth is configured', async () => {
    const res = await GET(makeGetRequest('?connectionType=oauth'));

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe(
      'https://jumia.com/auth?state=xyz'
    );
    expect(mockGetJumiaRedirectUri).toHaveBeenCalledWith(PUBLIC_APP_URL);
    expect(mockGetJumiaAuthUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: 'test-client-id',
        redirectUri: PUBLIC_CALLBACK_URL,
      })
    );
  });

  it('returns connection status for bearer-authenticated mobile requests', async () => {
    mockSupabase.from.mockReturnValueOnce({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: [
                {
                  id: INTEGRATION_ID,
                  shop_id: 'shop-1',
                  shop_name: 'Jumia NG',
                  country_code: 'NG',
                  marketplace_key: 'NG-main',
                  is_active: true,
                  last_sync_at: null,
                  sync_error: null,
                  connection_method: 'self_authorization',
                  token_expires_at: '2030-01-01T00:00:00.000Z',
                },
              ],
            }),
          }),
        }),
      }),
    });

    const res = await GET(makeBearerGetRequest());

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      connected: true,
      integrations: [
        {
          id: INTEGRATION_ID,
          shop_id: 'shop-1',
          shop_name: 'Jumia NG',
          country_code: 'NG',
          marketplace_key: 'NG-main',
          is_active: true,
          last_sync_at: null,
          sync_error: null,
          connection_method: 'self_authorization',
          token_expires_at: '2030-01-01T00:00:00.000Z',
        },
      ],
    });
    expect(mockAuthenticateApiRequest).toHaveBeenCalled();
  });

  it('returns 500 when the connection status query fails', async () => {
    mockSupabase.from.mockReturnValueOnce({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: null,
              error: { message: 'Database error' },
            }),
          }),
        }),
      }),
    });

    const res = await GET(makeBearerGetRequest());

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({
      error: 'Database error',
    });
  });
});

describe('Connect DELETE', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReset();
    mockHasPermission.mockReturnValue(true);
    mockPurgeOrphanedAuthorization.mockResolvedValue('purged');
    setupAuth();
    mockAuthenticateApiRequest.mockResolvedValue({
      user: { id: 'u1' },
      supabase: mockSupabase,
      error: null,
    });
  });

  afterEach(() => {
    restoreEnv();
  });

  it('returns 401 when unauthenticated', async () => {
    mockAuthenticateApiRequest.mockResolvedValue({
      user: null,
      supabase: null,
      error: 'no',
    });

    const res = await DELETE(makeBearerDeleteRequest());

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({
      error: 'Unauthorized',
    });
  });

  it('returns 403 on CSRF failure', async () => {
    const { checkCsrfProtection } = await import('@/lib/csrf');
    (checkCsrfProtection as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      valid: false,
    });

    const res = await DELETE(makeBearerDeleteRequest());

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: 'CSRF validation failed',
    });
    expect(mockAuthenticateApiRequest).not.toHaveBeenCalled();
  });

  it('returns 404 when merchant is not found', async () => {
    mockGetMerchant.mockResolvedValueOnce(null);

    const res = await DELETE(makeBearerDeleteRequest());

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({
      error: 'Merchant not found',
    });
  });

  it('returns 403 when permission is denied', async () => {
    const { hasPermission } = await import('@/lib/api-auth');
    (hasPermission as ReturnType<typeof vi.fn>).mockReturnValueOnce(false);

    const res = await DELETE(makeBearerDeleteRequest());

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: 'Forbidden',
    });
  });

  it('disconnects a Jumia integration for bearer-authenticated mobile requests', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: { id: INTEGRATION_ID },
      error: null,
    });
    const select = vi.fn().mockReturnValue({ maybeSingle });
    const eqMerchant = vi.fn().mockReturnValue({ select });
    const eqId = vi.fn().mockReturnValue({ eq: eqMerchant });
    const update = vi.fn().mockReturnValue({ eq: eqId });
    mockSupabase.from.mockReturnValueOnce({ update });

    const res = await DELETE(makeBearerDeleteRequest(`?id=${INTEGRATION_ID}`));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      success: true,
      message: 'Jumia account disconnected',
      cleanupPending: false,
    });
    expect(mockAuthenticateApiRequest).toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({ is_active: false });
    expect(eqId).toHaveBeenCalledWith('id', INTEGRATION_ID);
    expect(eqMerchant).toHaveBeenCalledWith(
      'merchant_id',
      MERCHANT_CTX.merchantId
    );
  });

  it('returns 400 when integration id is missing', async () => {
    const res = await DELETE(makeBearerDeleteRequest());

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: 'Invalid input',
      details: {
        fieldErrors: {
          id: expect.arrayContaining([expect.any(String)]),
        },
      },
    });
  });

  it('returns 400 when integration id is blank', async () => {
    const res = await DELETE(makeBearerDeleteRequest('?id=%20%20'));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: 'Invalid input',
      details: {
        fieldErrors: {
          id: expect.arrayContaining([expect.any(String)]),
        },
      },
    });
  });

  it('returns 400 when integration id is not a UUID', async () => {
    const res = await DELETE(makeBearerDeleteRequest('?id=int-1'));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: 'Invalid input',
      details: {
        fieldErrors: {
          id: expect.arrayContaining([expect.any(String)]),
        },
      },
    });
    expect(mockSupabase.from).not.toHaveBeenCalled();
  });

  it('returns 500 when the disconnect update fails', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'db error' },
    });
    const select = vi.fn().mockReturnValue({ maybeSingle });
    const eqMerchant = vi.fn().mockReturnValue({ select });
    const eqId = vi.fn().mockReturnValue({ eq: eqMerchant });
    mockSupabase.from.mockReturnValueOnce({
      update: vi.fn().mockReturnValue({ eq: eqId }),
    });

    const res = await DELETE(makeBearerDeleteRequest(`?id=${INTEGRATION_ID}`));

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({
      error: 'Failed to disconnect',
    });
  });

  it('returns 409 when a reconnect wins the race during disconnect', async () => {
    mockPurgeOrphanedAuthorization.mockResolvedValueOnce('reactivated');
    const maybeSingle = vi.fn().mockResolvedValue({
      data: { id: INTEGRATION_ID },
      error: null,
    });
    const select = vi.fn().mockReturnValue({ maybeSingle });
    const eqMerchant = vi.fn().mockReturnValue({ select });
    const eqId = vi.fn().mockReturnValue({ eq: eqMerchant });
    mockSupabase.from.mockReturnValueOnce({
      update: vi.fn().mockReturnValue({ eq: eqId }),
    });

    const res = await DELETE(makeBearerDeleteRequest(`?id=${INTEGRATION_ID}`));

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({
      error:
        'Integration was reconnected during disconnect; try again if you still want to disconnect',
    });
  });

  it('returns successful disconnect with cleanup pending when purge fails', async () => {
    mockPurgeOrphanedAuthorization.mockResolvedValueOnce('failed');
    const maybeSingle = vi.fn().mockResolvedValue({
      data: { id: INTEGRATION_ID },
      error: null,
    });
    const select = vi.fn().mockReturnValue({ maybeSingle });
    const eqMerchant = vi.fn().mockReturnValue({ select });
    const eqId = vi.fn().mockReturnValue({ eq: eqMerchant });
    mockSupabase.from.mockReturnValueOnce({
      update: vi.fn().mockReturnValue({ eq: eqId }),
    });

    const res = await DELETE(makeBearerDeleteRequest(`?id=${INTEGRATION_ID}`));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      success: true,
      message: 'Jumia account disconnected; credential cleanup is pending',
      cleanupPending: true,
    });
  });

  it('returns 404 when integration is not found for the merchant', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: null,
      error: null,
    });
    const select = vi.fn().mockReturnValue({ maybeSingle });
    const eqMerchant = vi.fn().mockReturnValue({ select });
    const eqId = vi.fn().mockReturnValue({ eq: eqMerchant });
    mockSupabase.from.mockReturnValueOnce({
      update: vi.fn().mockReturnValue({ eq: eqId }),
    });

    const res = await DELETE(
      makeBearerDeleteRequest(`?id=${OTHER_INTEGRATION_ID}`)
    );

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({
      error: 'Integration not found',
    });
  });
});
