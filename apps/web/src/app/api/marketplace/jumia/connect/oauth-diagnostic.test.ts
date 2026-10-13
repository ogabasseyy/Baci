import { NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetPlatformAdminAuth = vi.fn();
const mockLoggerInfo = vi.fn();

vi.mock('@/lib/logger', () => ({
  logger: { info: (...args: unknown[]) => mockLoggerInfo(...args) },
}));

vi.mock('@/lib/platform-admin-auth', () => ({
  getPlatformAdminAuth: (...args: unknown[]) =>
    mockGetPlatformAdminAuth(...args),
}));

import { jumiaOAuthInitiationDiagnostic } from './oauth-diagnostic';

describe('Jumia OAuth initiation diagnostic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPlatformAdminAuth.mockResolvedValue({
      status: 'authenticated',
      user: { id: 'user-1' },
    });
  });

  it('rejects a mobile diagnostic before checking admin authorization', async () => {
    const result = await jumiaOAuthInitiationDiagnostic.getContext({
      apiUserId: 'user-1',
      searchParams: new URLSearchParams(
        'diagnostic=token-shape&platform=mobile&variant=F'
      ),
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.response.status).toBe(400);
    expect(mockGetPlatformAdminAuth).not.toHaveBeenCalled();
  });

  it('rejects variant F when the request is not a diagnostic', async () => {
    const result = await jumiaOAuthInitiationDiagnostic.getContext({
      apiUserId: 'user-1',
      searchParams: new URLSearchParams('variant=F'),
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.response.status).toBe(400);
  });

  it('clears diagnostic state from an ordinary OAuth response', () => {
    const response = NextResponse.redirect('https://vendor-api.jumia.com');

    jumiaOAuthInitiationDiagnostic.applyResponse({
      diagnosticRequested: false,
      merchantId: 'merchant-1',
      platform: null,
      redirectUrl: 'https://vendor-api.jumia.com/login',
      response,
      state: 'oauth-state',
    });

    expect(response.cookies.get('jumia_oauth_state')?.value).toBe(
      'oauth-state'
    );
    expect(response.cookies.get('jumia_merchant_id')?.value).toBe('merchant-1');
    expect(response.headers.get('set-cookie')).toContain(
      'jumia_oauth_diagnostic=;'
    );
    expect(mockLoggerInfo).not.toHaveBeenCalled();
  });
});
