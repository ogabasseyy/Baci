import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { jumiaOAuthDiagnostic } from '@/lib/jumia/oauth-diagnostic';
import { jumiaOAuthCallbackRedirect } from './oauth-redirect';

function makeRequest(cookie?: string) {
  return new NextRequest('https://usebaci.com/api/marketplace/jumia/callback', {
    headers: cookie ? { cookie } : undefined,
  });
}

describe('Jumia OAuth callback redirect', () => {
  it('builds the dashboard redirect without clearing ordinary OAuth state', () => {
    const response = jumiaOAuthCallbackRedirect.create(makeRequest(), {
      success: 'jumia_connected',
    });

    expect(response.headers.get('location')).toBe(
      'https://usebaci.com/dashboard/channels?success=jumia_connected'
    );
    expect(response.headers.get('cache-control')).toBeNull();
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('returns a no-store response and clears all OAuth cookies for diagnostics', () => {
    const response = jumiaOAuthCallbackRedirect.create(
      makeRequest(`${jumiaOAuthDiagnostic.cookieName}=diagnostic-id`),
      { diagnostic: 'token-shape' }
    );
    const setCookie = response.headers.get('set-cookie') ?? '';

    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(setCookie).toContain(`${jumiaOAuthDiagnostic.cookieName}=`);
    expect(setCookie).toContain('jumia_oauth_state=');
    expect(setCookie).toContain('jumia_merchant_id=');
  });

  it('builds an encoded mobile deep link from the platform cookie', () => {
    const response = jumiaOAuthCallbackRedirect.create(
      makeRequest('jumia_oauth_platform=mobile'),
      { code: 'code with spaces', ticketId: 'ticket/1' }
    );

    expect(response.headers.get('location')).toBe(
      'baciadmin://sales-channels?code=code+with+spaces&ticketId=ticket%2F1'
    );
  });

  it('clears diagnostic state and disables caching on a mobile redirect', () => {
    const response = jumiaOAuthCallbackRedirect.create(
      makeRequest(
        `jumia_oauth_platform=mobile; ${jumiaOAuthDiagnostic.cookieName}=diagnostic-id`
      ),
      { jumia_diagnostic: 'complete' }
    );

    expect(response.headers.get('location')).toBe(
      'baciadmin://sales-channels?jumia_diagnostic=complete'
    );
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('set-cookie')).toContain(
      `${jumiaOAuthDiagnostic.cookieName}=;`
    );
  });
});
