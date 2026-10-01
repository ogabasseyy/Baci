import { NextResponse } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockExchangeJumiaCode = vi.fn();
const mockGetPlatformAdminAuth = vi.fn();

vi.mock('@/lib/jumia/helpers', async () => {
  const actual = await vi.importActual<typeof import('@/lib/jumia/helpers')>(
    '@/lib/jumia/helpers'
  );
  return {
    ...actual,
    exchangeJumiaCode: (...args: unknown[]) => mockExchangeJumiaCode(...args),
  };
});

vi.mock('@/lib/platform-admin-auth', () => ({
  getPlatformAdminAuth: (...args: unknown[]) =>
    mockGetPlatformAdminAuth(...args),
}));

import { runJumiaOAuthCallbackDiagnostic } from './oauth-diagnostic';

function createRedirect(query: Record<string, string | undefined>) {
  const url = new URL('https://usebaci.com/dashboard/channels');
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) {
      url.searchParams.set(key, value);
    }
  }
  return NextResponse.redirect(url);
}

const baseInput = {
  apiUserId: 'user-1',
  clientId: 'client-id',
  clientSecret: 'client-secret-must-never-escape',
  code: 'authorization-code-must-never-escape',
  createRedirect,
  diagnosticId: 'diagnostic-id',
  redirectUri: 'https://usebaci.com/api/marketplace/jumia/callback',
  requestUrl:
    'https://usebaci.com/api/marketplace/jumia/callback?code=redacted',
  variant: 'F',
};

describe('Jumia OAuth callback diagnostic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockGetPlatformAdminAuth.mockResolvedValue({
      status: 'authenticated',
      user: { id: 'user-1' },
    });
    mockExchangeJumiaCode.mockResolvedValue({
      access_token: 'access-token-must-never-escape',
      expires_in: 3600,
      refresh_token: 'refresh-token-must-never-escape',
      token_type: 'bearer',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns safe token-shape evidence without exposing credentials', async () => {
    const response = await runJumiaOAuthCallbackDiagnostic(baseInput);
    const location = response.headers.get('location') ?? '';

    expect(location).toContain('has_refresh_token=true');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const serialized = JSON.stringify({
      location,
      logs: vi.mocked(console.info).mock.calls,
    });
    expect(serialized).toContain('"callback_code_length":36');
    expect(serialized).toContain('"access_grant_present":true');
    expect(serialized).toContain('"refresh_grant_present":true');
    expect(serialized).toContain('"grant_type":"bearer"');
    expect(serialized).toContain('"exchange_duration_ms":');
    expect(serialized).not.toContain('[REDACTED]');
    expect(serialized).not.toContain('access-token-must-never-escape');
    expect(serialized).not.toContain('refresh-token-must-never-escape');
    expect(serialized).not.toContain('authorization-code-must-never-escape');
    expect(serialized).not.toContain('client-secret-must-never-escape');
  });

  it('rejects an authenticated platform admin with a different identity', async () => {
    mockGetPlatformAdminAuth.mockResolvedValueOnce({
      status: 'authenticated',
      user: { id: 'user-2' },
    });

    const response = await runJumiaOAuthCallbackDiagnostic(baseInput);

    expect(response.headers.get('location')).toContain(
      'error=diagnostic_forbidden'
    );
    expect(mockExchangeJumiaCode).not.toHaveBeenCalled();
  });

  it.each([
    'unauthenticated',
    'forbidden',
  ] as const)('rejects the %s platform-admin status before token exchange', async (status) => {
    mockGetPlatformAdminAuth.mockResolvedValueOnce({ status });

    const response = await runJumiaOAuthCallbackDiagnostic(baseInput);

    expect(response.headers.get('location')).toContain(
      'error=diagnostic_forbidden'
    );
    expect(mockExchangeJumiaCode).not.toHaveBeenCalled();
  });

  it('does not report OAuth state matching as hard-coded evidence', async () => {
    await runJumiaOAuthCallbackDiagnostic(baseInput);

    expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toContain(
      'oauth_state_match'
    );
  });

  it('redacts provider credentials when token exchange fails', async () => {
    mockExchangeJumiaCode.mockRejectedValueOnce(
      Object.assign(new Error('Token exchange failed'), {
        details: JSON.stringify({
          client_secret: 'client-secret-must-never-escape',
          code: 'authorization-code-must-never-escape',
          refresh_token: 'refresh-token-must-never-escape',
        }),
        status: 400,
      })
    );

    const response = await runJumiaOAuthCallbackDiagnostic(baseInput);

    expect(response.headers.get('location')).toContain(
      'error=token_exchange_failed'
    );
    const serializedLogs = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(serializedLogs).not.toContain('client-secret-must-never-escape');
    expect(serializedLogs).not.toContain(
      'authorization-code-must-never-escape'
    );
    expect(serializedLogs).not.toContain('refresh-token-must-never-escape');
  });

  it.each([
    null,
    undefined,
  ])('redirects safely when token exchange throws %s', async (tokenError) => {
    mockExchangeJumiaCode.mockRejectedValueOnce(tokenError);

    const response = await runJumiaOAuthCallbackDiagnostic(baseInput);

    expect(response.headers.get('location')).toContain(
      'error=token_exchange_failed'
    );
  });
});
