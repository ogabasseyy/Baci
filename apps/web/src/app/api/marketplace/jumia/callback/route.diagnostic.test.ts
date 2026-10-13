import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockAuthenticateApiRequest = vi.fn();
const mockExchangeJumiaCode = vi.fn();
const mockGetMerchantFeatureAccess = vi.fn();
const mockGetMerchantIdForApiUser = vi.fn();
const mockGetPlatformAdminAuth = vi.fn();
const mockGetShops = vi.fn();
const mockLoggerError = vi.fn();
const mockLoggerInfo = vi.fn();
const mockLoggerWarn = vi.fn();
const mockSupabaseFrom = vi.fn(() => {
  throw new Error(
    'Diagnostic callback must not query marketplace integrations'
  );
});

vi.mock('@/env', () => ({
  getConfiguredAppUrl: vi.fn(() => 'https://usebaci.com'),
  getJumiaClientId: vi.fn(() => 'web-client-id'),
  getJumiaClientSecret: vi.fn(() => 'client-secret-must-never-be-logged'),
}));

vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: (...args: unknown[]) =>
    mockAuthenticateApiRequest(...args),
  getMerchantIdForApiUser: (...args: unknown[]) =>
    mockGetMerchantIdForApiUser(...args),
}));

vi.mock('@/lib/jumia/client', () => ({
  JumiaClient: class {
    getShops() {
      return mockGetShops();
    }
  },
}));

vi.mock('@/lib/jumia/helpers', async () => {
  const actual = await vi.importActual<typeof import('@/lib/jumia/helpers')>(
    '@/lib/jumia/helpers'
  );
  return {
    ...actual,
    exchangeJumiaCode: (...args: unknown[]) => mockExchangeJumiaCode(...args),
    getJumiaRedirectUri: vi.fn(
      () => 'https://usebaci.com/api/marketplace/jumia/callback'
    ),
  };
});

vi.mock('@/lib/logger', () => ({
  logger: {
    error: (...args: unknown[]) => mockLoggerError(...args),
    info: (...args: unknown[]) => mockLoggerInfo(...args),
    warn: (...args: unknown[]) => mockLoggerWarn(...args),
  },
}));

vi.mock('@/lib/merchant-feature-gates', () => ({
  getMerchantFeatureAccess: (...args: unknown[]) =>
    mockGetMerchantFeatureAccess(...args),
}));

vi.mock('@/lib/platform-admin-auth', () => ({
  getPlatformAdminAuth: (...args: unknown[]) =>
    mockGetPlatformAdminAuth(...args),
}));

import { GET } from './route';

function makeRequest(
  diagnosticCookie = '11111111-1111-4111-8111-111111111111'
) {
  const state = 'jumia-diagnostic-oauth-state';
  return new NextRequest(
    `https://usebaci.com/api/marketplace/jumia/callback?code=auth-code-must-never-be-logged&state=${state}`,
    {
      headers: {
        cookie: [
          `jumia_oauth_state=${state}`,
          'jumia_merchant_id=merchant-1',
          'jumia_oauth_variant=F',
          `jumia_oauth_diagnostic=${diagnosticCookie}`,
        ].join('; '),
      },
    }
  );
}

describe('Jumia OAuth callback diagnostic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticateApiRequest.mockResolvedValue({
      error: null,
      supabase: { from: mockSupabaseFrom },
      user: { id: 'user-1' },
    });
    mockGetMerchantIdForApiUser.mockResolvedValue('merchant-1');
    mockGetMerchantFeatureAccess.mockResolvedValue({
      allowed: true,
      error: null,
    });
    mockGetPlatformAdminAuth.mockResolvedValue({
      status: 'authenticated',
      user: { email: 'admin@example.com', id: 'user-1' },
    });
    mockExchangeJumiaCode.mockResolvedValue({
      access_token: 'access-token-must-never-be-logged',
      expires_in: 3600,
      token_type: 'bearer',
    });
  });

  it('fails closed on a malformed diagnostic cookie without persisting OAuth', async () => {
    const response = await GET(makeRequest('not-a-uuid'));

    expect(response.headers.get('location')).toContain(
      'error=diagnostic_invalid'
    );
    expect(mockGetMerchantIdForApiUser).not.toHaveBeenCalled();
    expect(mockExchangeJumiaCode).not.toHaveBeenCalled();
    expect(mockSupabaseFrom).not.toHaveBeenCalled();
  });

  it('reports access-token-only evidence without shop discovery or persistence', async () => {
    const response = await GET(makeRequest());
    const location = response.headers.get('location') ?? '';

    expect(response.status).toBe(307);
    expect(location).toContain('jumia_diagnostic=complete');
    expect(location).toContain('has_refresh_token=false');
    expect(location).toContain('persistence_skipped=true');
    expect(location).not.toContain('access-token-must-never-be-logged');
    expect(location).not.toContain('auth-code-must-never-be-logged');
    expect(mockGetShops).not.toHaveBeenCalled();
    expect(mockSupabaseFrom).not.toHaveBeenCalled();
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('set-cookie')).toContain(
      'jumia_oauth_diagnostic=;'
    );

    const serializedLogs = JSON.stringify(mockLoggerInfo.mock.calls);
    expect(serializedLogs).toContain('Callback accepted');
    expect(serializedLogs).toContain('Token exchange completed');
    expect(serializedLogs).not.toContain('access-token-must-never-be-logged');
    expect(serializedLogs).not.toContain('auth-code-must-never-be-logged');
    expect(serializedLogs).not.toContain('client-secret-must-never-be-logged');
  });

  it('reports refresh-token presence without exposing the refresh token', async () => {
    mockExchangeJumiaCode.mockResolvedValueOnce({
      access_token: 'access-token-must-never-be-logged',
      expires_in: 3600,
      refresh_expires_in: 7200,
      refresh_token: 'refresh-token-must-never-be-logged',
      token_type: 'bearer',
    });

    const response = await GET(makeRequest());
    const location = response.headers.get('location') ?? '';

    expect(location).toContain('has_refresh_token=true');
    expect(location).toContain('refresh_expires_in=7200');
    expect(location).not.toContain('refresh-token-must-never-be-logged');
    expect(JSON.stringify(mockLoggerInfo.mock.calls)).not.toContain(
      'refresh-token-must-never-be-logged'
    );
    expect(mockSupabaseFrom).not.toHaveBeenCalled();
  });

  it('rejects a forged diagnostic cookie before exchanging the code', async () => {
    mockGetPlatformAdminAuth.mockResolvedValueOnce({ status: 'forbidden' });

    const response = await GET(makeRequest());

    expect(response.headers.get('location')).toContain(
      'error=diagnostic_forbidden'
    );
    expect(mockExchangeJumiaCode).not.toHaveBeenCalled();
    expect(mockSupabaseFrom).not.toHaveBeenCalled();
  });

  it('fails closed when a bound diagnostic state has no marker cookie', async () => {
    const state = 'jumia-diagnostic-oauth-state';
    const response = await GET(
      new NextRequest(
        `https://usebaci.com/api/marketplace/jumia/callback?code=auth-code&state=${state}`,
        {
          headers: {
            cookie: `jumia_oauth_state=${state}; jumia_merchant_id=merchant-1`,
          },
        }
      )
    );

    expect(response.headers.get('location')).toContain(
      'error=diagnostic_invalid'
    );
    expect(mockGetMerchantIdForApiUser).not.toHaveBeenCalled();
    expect(mockGetMerchantFeatureAccess).not.toHaveBeenCalled();
    expect(mockExchangeJumiaCode).not.toHaveBeenCalled();
    expect(mockSupabaseFrom).not.toHaveBeenCalled();
  });

  it('rejects a platform-admin identity that differs from the API user', async () => {
    mockGetPlatformAdminAuth.mockResolvedValueOnce({
      status: 'authenticated',
      user: { email: 'other-admin@example.com', id: 'user-2' },
    });

    const response = await GET(makeRequest());

    expect(response.headers.get('location')).toContain(
      'error=diagnostic_forbidden'
    );
    expect(mockExchangeJumiaCode).not.toHaveBeenCalled();
    expect(mockSupabaseFrom).not.toHaveBeenCalled();
  });

  it('clears diagnostic state and keeps provider failures credential-safe', async () => {
    mockExchangeJumiaCode.mockRejectedValueOnce(
      Object.assign(new Error('Token exchange failed'), {
        details: JSON.stringify({
          client_secret: 'client-secret-must-never-be-logged',
          code: 'auth-code-must-never-be-logged',
          error: 'invalid_grant',
          refresh_token: 'refresh-token-must-never-be-logged',
        }),
        status: 400,
      })
    );

    const response = await GET(makeRequest());

    expect(response.headers.get('location')).toContain(
      'error=token_exchange_failed'
    );
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('set-cookie')).toContain(
      'jumia_oauth_diagnostic=;'
    );
    const serializedLogs = JSON.stringify(mockLoggerError.mock.calls);
    expect(serializedLogs).toContain('invalid_grant');
    expect(serializedLogs).not.toContain('client-secret-must-never-be-logged');
    expect(serializedLogs).not.toContain('auth-code-must-never-be-logged');
    expect(serializedLogs).not.toContain('refresh-token-must-never-be-logged');
    expect(mockSupabaseFrom).not.toHaveBeenCalled();
  });
});
