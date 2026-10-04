import { buildJumiaMobileReturnUrl } from '@baci/shared';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const PUBLIC_APP_URL = 'https://example.com/';
const PUBLIC_CALLBACK_URL =
  'https://example.com/api/marketplace/jumia/callback';

const mockAuthenticateApiRequest = vi.fn();
const mockGetMerchantIdForApiUser = vi.fn();
const mockGetUserAccess = vi.fn();
const { mockHasPermission } = vi.hoisted(() => ({
  mockHasPermission: vi.fn(
    (_access: unknown, _resource: string, _action: string) => true
  ),
}));
const mockGetMerchantFeatureAccess = vi.fn();
const mockExchangeJumiaCode = vi.fn();
const mockGetShops = vi.fn();
const mockLoggerError = vi.fn();
const mockLoggerWarn = vi.fn();
const mockUpsert = vi.fn().mockResolvedValue({ data: true, error: null });
let mockExistingIntegrations: Array<{ shop_id: string; is_active: boolean }> =
  [];
let mockExistingIntegrationsError: unknown = null;
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

const mockSupabase = {
  rpc: (...args: unknown[]) => mockUpsert(...args),
  from: vi.fn((table: string) => {
    if (table !== 'marketplace_integrations') {
      throw new Error(`Unexpected table: ${table}`);
    }

    return {
      select: vi.fn(() => {
        const filters: Record<string, unknown> = {};

        return {
          eq(column: string, value: unknown) {
            filters[column] = value;
            if ('merchant_id' in filters && 'platform' in filters) {
              return Promise.resolve({
                data: mockExistingIntegrations,
                error: mockExistingIntegrationsError,
              });
            }
            return this;
          },
        };
      }),
      upsert: (...args: unknown[]) => mockUpsert(...args),
    };
  }),
};

vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: (...args: unknown[]) =>
    mockAuthenticateApiRequest(...args),
  getMerchantIdForApiUser: (...args: unknown[]) =>
    mockGetMerchantIdForApiUser(...args),
  getUserAccess: (...args: unknown[]) => mockGetUserAccess(...args),
  hasPermission: mockHasPermission,
}));

vi.mock('@/lib/jumia/helpers', async () => {
  const actual = await vi.importActual<typeof import('@/lib/jumia/helpers')>(
    '@/lib/jumia/helpers'
  );

  return {
    ...actual,
    exchangeJumiaCode: (...args: unknown[]) => mockExchangeJumiaCode(...args),
    getJumiaRedirectUri: (appUrl: string) => mockGetJumiaRedirectUri(appUrl),
  };
});

vi.mock('@/lib/jumia/client', () => ({
  JumiaClient: class {
    getShops() {
      return mockGetShops();
    }
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    error: (...args: unknown[]) => mockLoggerError(...args),
    warn: (...args: unknown[]) => mockLoggerWarn(...args),
  },
}));

vi.mock('@/lib/merchant-feature-gates', () => ({
  getMerchantFeatureAccess: (...args: unknown[]) =>
    mockGetMerchantFeatureAccess(...args),
}));

vi.mock('@/env', () => ({
  getConfiguredAppUrl: mockGetConfiguredAppUrl,
  getJumiaClientId: vi.fn(() => process.env.JUMIA_CLIENT_ID),
  getJumiaClientSecret: vi.fn(() => process.env.JUMIA_CLIENT_SECRET),
}));

import { GET } from './route';

const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;
const originalJumiaClientId = process.env.JUMIA_CLIENT_ID;
const originalJumiaClientSecret = process.env.JUMIA_CLIENT_SECRET;

function makeCallbackRequest({
  code = 'auth-code',
  state = 'test-state',
  cookieState = 'test-state',
  merchantCookie = '00000000-0000-4000-8000-000000000001',
  diagnosticCookie,
  ticketCookie,
  platform,
}: {
  code?: string | null;
  state?: string;
  cookieState?: string;
  merchantCookie?: string | null;
  diagnosticCookie?: string;
  ticketCookie?: string | null;
  platform?: 'mobile';
} = {}) {
  const url = new URL('http://localhost:3000/api/marketplace/jumia/callback');

  if (code !== null) {
    url.searchParams.set('code', code);
  }
  url.searchParams.set('state', state);

  const cookieParts = [`jumia_oauth_state=${cookieState}`];
  if (merchantCookie) {
    cookieParts.push(`jumia_merchant_id=${merchantCookie}`);
  }
  if (platform) {
    cookieParts.push(`jumia_oauth_platform=${platform}`);
  }
  if (ticketCookie != null) {
    cookieParts.push(`jumia_ticket_id=${ticketCookie}`);
  }
  if (diagnosticCookie) {
    cookieParts.push(`jumia_oauth_diagnostic=${diagnosticCookie}`);
  }

  return new NextRequest(url, {
    headers: {
      cookie: cookieParts.join('; '),
    },
  });
}

describe('Jumia callback route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistingIntegrations = [];
    mockExistingIntegrationsError = null;
    process.env.NEXT_PUBLIC_APP_URL = PUBLIC_APP_URL;
    process.env.JUMIA_CLIENT_ID = 'test-client-id';
    process.env.JUMIA_CLIENT_SECRET = 'test-client-secret';
    mockAuthenticateApiRequest.mockResolvedValue({
      user: { id: 'user-1' },
      error: null,
      supabase: mockSupabase,
    });
    mockUpsert.mockResolvedValue({ data: true, error: null });
    mockGetMerchantIdForApiUser.mockResolvedValue(
      '00000000-0000-4000-8000-000000000001'
    );
    mockGetUserAccess.mockResolvedValue({
      merchantId: '00000000-0000-4000-8000-000000000001',
      role: 'owner',
      isOwner: true,
      isStaff: false,
      permissions: {},
    });
    mockHasPermission.mockReset();
    mockHasPermission.mockReturnValue(true);
    mockGetMerchantFeatureAccess.mockResolvedValue({
      allowed: true,
      error: null,
    });
    mockExchangeJumiaCode.mockResolvedValue({
      access_token: 'access',
      refresh_token: 'refresh',
      expires_in: 3600,
      token_type: 'Bearer',
    });
    mockGetShops.mockResolvedValue([
      {
        id: 'shop-1',
        name: 'Jumia Shop',
        email: 'shop@example.com',
        businessClients: [
          {
            name: 'Jumia Nigeria',
            code: 'jumia_ng',
            countryCode: 'NG',
            countryName: 'Nigeria',
            status: 'active',
            shortCode: 'NG',
          },
        ],
      },
    ]);
  });

  afterEach(() => {
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

    if (originalJumiaClientSecret === undefined) {
      delete process.env.JUMIA_CLIENT_SECRET;
    } else {
      process.env.JUMIA_CLIENT_SECRET = originalJumiaClientSecret;
    }
  });

  it('exchanges the code using the validated app callback URL', async () => {
    const request = makeCallbackRequest();

    const response = await GET(request);

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain(
      'success=jumia_connected&shops=shop-1'
    );
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    expect(mockUpsert).toHaveBeenCalledWith(
      'persist_jumia_oauth_integrations_atomically',
      expect.objectContaining({
        p_integrations: expect.arrayContaining([
          expect.objectContaining({
            merchant_id: '00000000-0000-4000-8000-000000000001',
            platform: 'jumia',
            shop_id: 'shop-1',
            shop_name: 'Jumia Shop',
            access_token: 'access',
            refresh_token: 'refresh',
            is_active: true,
            sync_config: expect.objectContaining({
              products: true,
              orders: true,
              stock: true,
            }),
          }),
        ]),
      })
    );
    expect(mockExchangeJumiaCode).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'auth-code',
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
        redirectUri: PUBLIC_CALLBACK_URL,
      })
    );
  });

  it('redirects with only newly activated shops after upsert', async () => {
    mockExistingIntegrations = [{ shop_id: 'shop-1', is_active: true }];
    mockGetShops.mockResolvedValue([
      {
        id: 'shop-1',
        name: 'Existing Shop',
        email: 'existing@example.com',
        businessClients: [
          {
            name: 'Jumia Nigeria',
            code: 'jumia_ng',
            countryCode: 'NG',
            countryName: 'Nigeria',
            status: 'active',
            shortCode: 'NG',
          },
        ],
      },
      {
        id: 'shop-2',
        name: 'New Shop',
        email: 'new@example.com',
        businessClients: [
          {
            name: 'Jumia Nigeria',
            code: 'jumia_ng',
            countryCode: 'NG',
            countryName: 'Nigeria',
            status: 'active',
            shortCode: 'NG',
          },
        ],
      },
    ]);

    const response = await GET(makeCallbackRequest());

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain(
      'success=jumia_connected&shops=shop-2'
    );
  });

  it('redirects with no_shops_discovered when discovery returns no shops', async () => {
    mockGetShops.mockResolvedValue([]);

    const response = await GET(makeCallbackRequest());

    expect(response.status).toBe(307);
    const location = response.headers.get('location') ?? '';
    expect(location).toContain('error=no_shops_discovered');
    expect(location).not.toContain('success=jumia_connected');
  });

  it('keeps the success redirect when reconnecting already-active shops', async () => {
    mockExistingIntegrations = [{ shop_id: 'shop-1', is_active: true }];

    const response = await GET(makeCallbackRequest());

    expect(response.status).toBe(307);
    const location = response.headers.get('location') ?? '';
    expect(location).toContain('success=jumia_connected');
    expect(location).not.toContain('error=');
  });

  it('redirects with invalid_state when the OAuth state does not match', async () => {
    const response = await GET(
      makeCallbackRequest({
        state: 'other-state',
      })
    );

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('error=invalid_state');
    expect(mockExchangeJumiaCode).not.toHaveBeenCalled();
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('uses the mobile deep link for invalid_state on mobile callbacks', async () => {
    const response = await GET(
      makeCallbackRequest({
        state: 'other-state',
        platform: 'mobile',
      })
    );

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      buildJumiaMobileReturnUrl({ error: 'invalid_state' })
    );
    expect(mockExchangeJumiaCode).not.toHaveBeenCalled();
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('uses the sales-channels deep link for successful mobile callbacks', async () => {
    const response = await GET(
      makeCallbackRequest({
        platform: 'mobile',
        ticketCookie: '22222222-2222-4222-8222-222222222222',
      })
    );

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      buildJumiaMobileReturnUrl({
        code: 'auth-code',
        ticketId: '22222222-2222-4222-8222-222222222222',
      })
    );
    expect(mockExchangeJumiaCode).not.toHaveBeenCalled();
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('redirects with no_code when the callback omits the code', async () => {
    const response = await GET(makeCallbackRequest({ code: null }));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('error=no_code');
    expect(mockExchangeJumiaCode).not.toHaveBeenCalled();
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('redirects with no_code when the callback provides an empty code', async () => {
    const response = await GET(makeCallbackRequest({ code: '' }));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('error=no_code');
    expect(mockExchangeJumiaCode).not.toHaveBeenCalled();
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('redirects with requires_upgrade before token exchange when marketplace sync is locked', async () => {
    mockGetMerchantFeatureAccess.mockResolvedValueOnce({
      allowed: false,
      error: null,
    });

    const response = await GET(makeCallbackRequest());

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain(
      'error=requires_upgrade'
    );
    expect(mockExchangeJumiaCode).not.toHaveBeenCalled();
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('redirects with plan_verification_failed before token exchange when entitlement lookup fails', async () => {
    mockGetMerchantFeatureAccess.mockResolvedValueOnce({
      allowed: false,
      error: { message: 'database unavailable' },
    });

    const response = await GET(makeCallbackRequest());

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain(
      'error=plan_verification_failed'
    );
    expect(mockExchangeJumiaCode).not.toHaveBeenCalled();
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('redirects with token_exchange_failed when the token exchange throws', async () => {
    mockExchangeJumiaCode.mockRejectedValueOnce(new Error('boom'));

    const response = await GET(makeCallbackRequest());

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain(
      'error=token_exchange_failed'
    );
    expect(mockExchangeJumiaCode).toHaveBeenCalledTimes(1);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('redirects with forbidden before exchanging when manage permission is revoked', async () => {
    mockHasPermission.mockReturnValueOnce(false);

    const response = await GET(makeCallbackRequest());

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('error=forbidden');
    expect(mockExchangeJumiaCode).not.toHaveBeenCalled();
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('logs sanitized Jumia token error details when token exchange is rejected', async () => {
    mockExchangeJumiaCode.mockRejectedValueOnce(
      Object.assign(new Error('Token exchange failed'), {
        status: 401,
        details: JSON.stringify({
          error: 'invalid_grant',
          error_description:
            'The requested redirect_uri is missing in the client configuration.',
          code: 'auth-code-123',
          client_secret: 'top-secret',
        }),
      })
    );

    const response = await GET(makeCallbackRequest());

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain(
      'error=token_exchange_failed'
    );
    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Jumia Callback Token exchange failed',
        redirectUri: PUBLIC_CALLBACK_URL,
        error: expect.objectContaining({
          name: 'Error',
          message: 'Token exchange failed',
          status: 401,
          details: expect.objectContaining({
            error: 'invalid_grant',
            error_description:
              'The requested redirect_uri is missing in the client configuration.',
            code: '[REDACTED]',
            client_secret: '[REDACTED]',
          }),
        }),
      })
    );
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('redirects with session_expired when the callback request is unauthenticated', async () => {
    mockAuthenticateApiRequest.mockResolvedValueOnce({
      user: null,
      error: 'unauthorized',
      supabase: null,
    });

    const response = await GET(makeCallbackRequest({ merchantCookie: null }));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('error=session_expired');
    expect(mockExchangeJumiaCode).not.toHaveBeenCalled();
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('redirects with merchant_not_found when the authenticated user has no merchant', async () => {
    mockGetMerchantIdForApiUser.mockResolvedValueOnce(null);

    const response = await GET(makeCallbackRequest());

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain(
      'error=merchant_not_found'
    );
    expect(mockExchangeJumiaCode).not.toHaveBeenCalled();
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('redirects with oauth_not_configured when Jumia client id is missing', async () => {
    delete process.env.JUMIA_CLIENT_ID;

    const response = await GET(makeCallbackRequest());

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain(
      'error=oauth_not_configured'
    );
    expect(mockExchangeJumiaCode).not.toHaveBeenCalled();
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('redirects with oauth_not_configured when Jumia client secret is missing', async () => {
    delete process.env.JUMIA_CLIENT_SECRET;

    const response = await GET(makeCallbackRequest());

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain(
      'error=oauth_not_configured'
    );
    expect(mockExchangeJumiaCode).not.toHaveBeenCalled();
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('redirects with oauth_not_configured when NEXT_PUBLIC_APP_URL is missing', async () => {
    delete process.env.NEXT_PUBLIC_APP_URL;

    const response = await GET(makeCallbackRequest());

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain(
      'error=oauth_not_configured'
    );
    expect(mockExchangeJumiaCode).not.toHaveBeenCalled();
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('redirects with database_error when persisting the integration fails', async () => {
    mockUpsert.mockResolvedValue({
      data: null,
      error: { message: 'DB error' },
    });

    const response = await GET(makeCallbackRequest());

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('error=database_error');
    expect(mockExchangeJumiaCode).toHaveBeenCalledTimes(1);
    expect(mockUpsert).toHaveBeenCalledTimes(3);
  });
});
