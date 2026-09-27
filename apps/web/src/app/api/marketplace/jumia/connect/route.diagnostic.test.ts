import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockAuthenticateApiRequest = vi.fn();
const mockGetMerchantForApiRequest = vi.fn();
const mockGetMerchantFeatureAccess = vi.fn();
const mockGetPlatformAdminAuth = vi.fn();
const mockGetJumiaAuthUrl = vi.fn();
const mockLoggerInfo = vi.fn();
const mockCreateClient = vi.fn();

vi.mock('@/env', () => ({
  getConfiguredAppUrl: vi.fn(() => 'https://usebaci.com'),
  getJumiaAuthorizationEncryptionKey: vi.fn(() => 'a'.repeat(44)),
  getJumiaClientId: vi.fn(() => 'web-client-id'),
}));

vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: (...args: unknown[]) =>
    mockAuthenticateApiRequest(...args),
  hasPermission: vi.fn(() => true),
}));

vi.mock('@/lib/get-merchant-for-api-request', () => ({
  getMerchantForApiRequest: (...args: unknown[]) =>
    mockGetMerchantForApiRequest(...args),
  toUserAccess: vi.fn(() => ({
    isOwner: true,
    isStaff: false,
    merchantId: 'merchant-1',
    permissions: {},
    role: 'owner',
  })),
}));

vi.mock('@/lib/jumia/helpers', () => ({
  getJumiaAuthUrl: (...args: unknown[]) => mockGetJumiaAuthUrl(...args),
  getJumiaRedirectUri: vi.fn(
    () => 'https://usebaci.com/api/marketplace/jumia/callback'
  ),
  isJumiaAuthUrlVariant: (value: string | null | undefined) =>
    ['A', 'B', 'C', 'D', 'E', 'F'].includes(value ?? ''),
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: (...args: unknown[]) => mockLoggerInfo(...args) },
}));

vi.mock('@/lib/merchant-feature-gates', () => ({
  getMerchantFeatureAccess: (...args: unknown[]) =>
    mockGetMerchantFeatureAccess(...args),
  merchantFeatureUpgradeResponse: vi.fn(),
}));

vi.mock('@/lib/platform-admin-auth', () => ({
  getPlatformAdminAuth: (...args: unknown[]) =>
    mockGetPlatformAdminAuth(...args),
}));

vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: vi.fn(async () => ({ valid: true })),
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: (...args: unknown[]) => mockCreateClient(...args),
}));
vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({})) }));

import { GET, POST } from './route';

function makeRequest(
  query = 'connectionType=oauth&diagnostic=token-shape&variant=F',
  cookie?: string
) {
  return new NextRequest(
    `https://usebaci.com/api/marketplace/jumia/connect?${query}`,
    cookie ? { headers: { cookie } } : undefined
  );
}

describe('Jumia OAuth connect diagnostic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateClient.mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-1' } },
          error: null,
        }),
      },
    });
    mockAuthenticateApiRequest.mockResolvedValue({
      error: null,
      supabase: {},
      user: { id: 'user-1' },
    });
    mockGetMerchantForApiRequest.mockResolvedValue({
      merchantId: 'merchant-1',
      staffAccess: {
        isOwner: true,
        isStaff: false,
        permissions: {},
        role: null,
      },
    });
    mockGetMerchantFeatureAccess.mockResolvedValue({
      allowed: true,
      error: null,
    });
    mockGetPlatformAdminAuth.mockResolvedValue({
      status: 'authenticated',
      user: { email: 'admin@example.com', id: 'user-1' },
    });
    mockGetJumiaAuthUrl.mockImplementation(
      ({ state }: { state: string }) =>
        `https://vendor-api.jumia.com/login?scope=openid&prompt=login&state=${state}`
    );
  });

  it('clears stale diagnostic context when ordinary POST OAuth starts', async () => {
    const response = await POST(
      new NextRequest(
        'https://usebaci.com/api/marketplace/jumia/connect?connectionType=oauth',
        {
          body: JSON.stringify({ connectionType: 'oauth' }),
          headers: {
            'content-type': 'application/json',
            cookie:
              'jumia_oauth_diagnostic=stale-id; jumia_oauth_variant=F; jumia_oauth_platform=mobile',
          },
          method: 'POST',
        }
      )
    );
    const setCookie = response.headers.get('set-cookie') ?? '';

    expect(response.status).toBe(200);
    expect(setCookie).toContain('jumia_oauth_diagnostic=;');
    expect(setCookie).toContain('jumia_oauth_variant=;');
    expect(setCookie).toContain('jumia_oauth_platform=;');
  });

  it('starts a platform-admin diagnostic and binds a correlation cookie', async () => {
    const response = await GET(makeRequest());

    expect(response.status).toBe(307);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.cookies.get('jumia_oauth_diagnostic')?.value).toMatch(
      /^[0-9a-f-]{36}$/
    );
    expect(mockGetJumiaAuthUrl).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'F' })
    );
    expect(mockLoggerInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        diagnostic_id: expect.any(String),
        message: '[Jumia OAuth Diagnostic] Authorization started',
        requested_max_age: null,
        requested_prompt: 'login',
        requested_scope: 'openid',
        variant: 'F',
      })
    );
  });

  it('rejects a diagnostic requested by a non-platform-admin user', async () => {
    mockGetPlatformAdminAuth.mockResolvedValueOnce({ status: 'forbidden' });

    const response = await GET(makeRequest());

    expect(response.status).toBe(403);
    expect(mockGetJumiaAuthUrl).not.toHaveBeenCalled();
    expect(mockGetMerchantFeatureAccess).not.toHaveBeenCalled();
    expect(response.cookies.get('jumia_oauth_diagnostic')).toBeUndefined();
  });

  it('rejects a platform-admin identity that differs from the API user', async () => {
    mockGetPlatformAdminAuth.mockResolvedValueOnce({
      status: 'authenticated',
      user: { email: 'other-admin@example.com', id: 'user-2' },
    });

    const response = await GET(makeRequest());

    expect(response.status).toBe(403);
    expect(mockGetJumiaAuthUrl).not.toHaveBeenCalled();
    expect(response.cookies.get('jumia_oauth_diagnostic')).toBeUndefined();
  });

  it('does not include the raw OAuth state in authorization evidence logs', async () => {
    await GET(makeRequest());

    const [{ state }] = mockGetJumiaAuthUrl.mock.calls[0] as [
      { state: string },
    ];
    expect(state).toMatch(/^jumia-diagnostic-[0-9a-f]{32}$/);
    expect(JSON.stringify(mockLoggerInfo.mock.calls)).not.toContain(state);
  });

  it('clears an abandoned diagnostic cookie before ordinary OAuth', async () => {
    const response = await GET(
      makeRequest(
        'connectionType=oauth',
        'jumia_oauth_diagnostic=stale-diagnostic-id'
      )
    );

    expect(response.status).toBe(307);
    expect(response.headers.get('set-cookie')).toContain(
      'jumia_oauth_diagnostic=;'
    );
    expect(mockGetPlatformAdminAuth).not.toHaveBeenCalled();
  });

  it('rejects mobile mode for a token-shape diagnostic', async () => {
    const response = await GET(
      makeRequest(
        'connectionType=oauth&diagnostic=token-shape&variant=F&platform=mobile'
      )
    );

    expect(response.status).toBe(400);
    expect(mockGetJumiaAuthUrl).not.toHaveBeenCalled();
  });

  it('rejects a mobile diagnostic before consuming a pending ticket', async () => {
    const response = await GET(
      makeRequest(
        'connectionType=oauth&diagnostic=token-shape&variant=F&platform=mobile&ticket=11111111-1111-4111-8111-111111111111'
      )
    );

    expect(response.status).toBe(400);
    expect(mockAuthenticateApiRequest).not.toHaveBeenCalled();
    expect(mockGetJumiaAuthUrl).not.toHaveBeenCalled();
  });

  it('rejects documented-baseline variant F outside diagnostic mode', async () => {
    const response = await GET(makeRequest('connectionType=oauth&variant=F'));

    expect(response.status).toBe(400);
    expect(mockGetJumiaAuthUrl).not.toHaveBeenCalled();
  });
});
