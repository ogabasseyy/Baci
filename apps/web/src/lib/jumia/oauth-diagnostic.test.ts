import { afterEach, describe, expect, it, vi } from 'vitest';
import { jumiaOAuthDiagnostic } from '@/lib/jumia/oauth-diagnostic';
import { logger } from '@/lib/logger';

describe('Jumia OAuth diagnostic evidence', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });
  it('reports refresh-token presence without exposing credential values', () => {
    const evidence = jumiaOAuthDiagnostic.buildEvidence({
      access_token: 'access-token-must-never-escape',
      expires_in: 3600,
      refresh_expires_in: 7200,
      refresh_token: 'refresh-token-must-never-escape',
      token_type: 'bearer',
    });

    expect(evidence).toEqual({
      expires_in: 3600,
      has_access_token: true,
      has_refresh_expires_in: true,
      has_refresh_token: true,
      persistence_skipped: true,
      refresh_expires_in: 7200,
      token_type: 'bearer',
    });
    expect(JSON.stringify(evidence)).not.toContain(
      'access-token-must-never-escape'
    );
    expect(JSON.stringify(evidence)).not.toContain(
      'refresh-token-must-never-escape'
    );
  });

  it('reports an access-token-only OAuth response', () => {
    expect(
      jumiaOAuthDiagnostic.buildEvidence({
        access_token: 'access-token-must-never-escape',
        expires_in: 3600,
        token_type: 'bearer',
      })
    ).toEqual({
      expires_in: 3600,
      has_access_token: true,
      has_refresh_expires_in: false,
      has_refresh_token: false,
      persistence_skipped: true,
      refresh_expires_in: null,
      token_type: 'bearer',
    });
  });

  it('normalizes provider-controlled token types to safe labels', () => {
    const evidence = jumiaOAuthDiagnostic.buildEvidence({
      access_token: 'access-secret',
      expires_in: 3600,
      refresh_token: 'refresh-secret',
      token_type: 'Bearer;refresh_token=secret',
    });

    expect(evidence.token_type).toBe('other');
  });

  it('builds a redirect query without exposing token values', () => {
    const query = jumiaOAuthDiagnostic.buildRedirectQuery({
      diagnosticId: 'diagnostic-id',
      tokens: {
        access_token: 'access-token-must-never-escape',
        expires_in: 3600,
        refresh_expires_in: 7200,
        refresh_token: 'refresh-token-must-never-escape',
        token_type: 'bearer',
      },
      variant: 'F',
    });

    expect(query).toEqual(
      expect.objectContaining({
        diagnostic_id: 'diagnostic-id',
        has_access_token: 'true',
        has_refresh_token: 'true',
        persistence_skipped: 'true',
        variant: 'F',
      })
    );
    expect(JSON.stringify(query)).not.toContain(
      'access-token-must-never-escape'
    );
    expect(JSON.stringify(query)).not.toContain(
      'refresh-token-must-never-escape'
    );
  });

  it('requires the exact diagnostic query value', () => {
    expect(
      jumiaOAuthDiagnostic.isRequested(
        new URLSearchParams('diagnostic=token-shape')
      )
    ).toBe(true);
    expect(
      jumiaOAuthDiagnostic.isRequested(new URLSearchParams('diagnostic=true'))
    ).toBe(false);
  });

  it('extracts safe authorization metadata and fingerprints the client id', () => {
    const evidence = jumiaOAuthDiagnostic.getAuthorizationEvidence(
      'https://vendor-api.jumia.com/login?client_id=client-id-must-never-escape&prompt=login&redirect_uri=https%3A%2F%2Fusebaci.com%2Fapi%2Fmarketplace%2Fjumia%2Fcallback&response_type=code&scope=openid'
    );

    expect(evidence.requested_prompt).toBe('login');
    expect(evidence.requested_scope).toBe('openid');
    expect(evidence.redirect_host).toBe('usebaci.com');
    expect(evidence.client_id_sha256_12).toHaveLength(12);
    expect(JSON.stringify(evidence)).not.toContain(
      'client-id-must-never-escape'
    );
  });

  it('emits authorization metadata through the real logger without redaction', () => {
    const infoSpy = vi
      .spyOn(console, 'info')
      .mockImplementation(() => undefined);
    const evidence = jumiaOAuthDiagnostic.getAuthorizationEvidence(
      'https://vendor-api.jumia.com/login?client_id=client-id&max_age=0&prompt=login&scope=openid'
    );

    logger.info({
      message: '[Jumia OAuth Diagnostic] Authorization started',
      ...evidence,
    });

    expect(infoSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        provider_host: 'vendor-api.jumia.com',
        requested_max_age: '0',
        requested_prompt: 'login',
        requested_scope: 'openid',
      })
    );
    expect(JSON.stringify(infoSpy.mock.calls)).not.toContain('[REDACTED]');
  });

  it('binds diagnostic mode to OAuth state without changing ordinary state', () => {
    expect(jumiaOAuthDiagnostic.bindState('random-state', true)).toBe(
      'jumia-diagnostic-random-state'
    );
    expect(jumiaOAuthDiagnostic.bindState('random-state', false)).toBe(
      'random-state'
    );
    expect(
      jumiaOAuthDiagnostic.isStateBound('jumia-diagnostic-random-state')
    ).toBe(true);
    expect(jumiaOAuthDiagnostic.isStateBound('random-state')).toBe(false);
  });

  it.each([
    null,
    '',
    '/relative/callback',
    'not a url',
  ])('reports null redirect_host for malformed redirect_uri %s', (redirectUri) => {
    const url = new URL('https://vendor-api.jumia.com/login');
    if (redirectUri !== null) {
      url.searchParams.set('redirect_uri', redirectUri);
    }

    expect(
      jumiaOAuthDiagnostic.getAuthorizationEvidence(url.toString())
        .redirect_host
    ).toBeNull();
  });
});
