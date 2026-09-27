import { afterEach, describe, expect, it, vi } from 'vitest';

const mockEnv = vi.hoisted(() => ({
  JUMIA_ENVIRONMENT: 'production' as 'staging' | 'production',
}));

vi.mock('@/env', () => ({
  env: mockEnv,
  getJumiaEnvironment: () => mockEnv.JUMIA_ENVIRONMENT,
}));

import {
  exchangeJumiaCode,
  getJumiaAuthUrl,
  getJumiaBaseUrl,
  getJumiaEnvironment,
  getJumiaRedirectUri,
  JumiaApiError,
  sanitizeJumiaErrorDetails,
  TOKEN_REFRESH_BUFFER_MS,
} from '@/lib/jumia/helpers';

describe('helpers', () => {
  afterEach(() => {
    mockEnv.JUMIA_ENVIRONMENT = 'production';
    delete process.env.NEXT_PUBLIC_APP_URL;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe('getJumiaEnvironment', () => {
    it('returns production by default', () => {
      expect(getJumiaEnvironment()).toBe('production');
    });

    it('returns staging when env is staging', () => {
      mockEnv.JUMIA_ENVIRONMENT = 'staging';
      expect(getJumiaEnvironment()).toBe('staging');
    });

    it('returns production when env is production', () => {
      mockEnv.JUMIA_ENVIRONMENT = 'production';
      expect(getJumiaEnvironment()).toBe('production');
    });
  });

  describe('getJumiaBaseUrl', () => {
    it('returns production URL by default', () => {
      expect(getJumiaBaseUrl()).toBe('https://vendor-api.jumia.com');
    });

    it('returns staging URL when passed staging', () => {
      expect(getJumiaBaseUrl('staging')).toBe(
        'https://vendor-api-staging.jumia.com'
      );
    });

    it('returns production URL when passed production', () => {
      expect(getJumiaBaseUrl('production')).toBe(
        'https://vendor-api.jumia.com'
      );
    });
  });

  describe('TOKEN_REFRESH_BUFFER_MS', () => {
    it('is 5 minutes in milliseconds', () => {
      expect(TOKEN_REFRESH_BUFFER_MS).toBe(5 * 60 * 1000);
    });
  });

  describe('sanitizeJumiaErrorDetails', () => {
    it('parses structured errors and redacts sensitive fields', () => {
      const sanitized = sanitizeJumiaErrorDetails(
        JSON.stringify({
          error: 'invalid_grant',
          error_description:
            'The requested redirect_uri is missing in the client configuration.',
          code: 'auth-code-123',
          client_secret: 'super-secret',
        })
      );

      expect(sanitized).toEqual({
        error: 'invalid_grant',
        error_description:
          'The requested redirect_uri is missing in the client configuration.',
        code: '[REDACTED]',
        client_secret: '[REDACTED]',
      });
    });

    it('returns malformed JSON strings unchanged when parsing fails', () => {
      expect(sanitizeJumiaErrorDetails('{invalid:}')).toBe('{invalid:}');
    });

    it('returns plain text strings unchanged when parsing fails', () => {
      expect(sanitizeJumiaErrorDetails('unexpected error text')).toBe(
        'unexpected error text'
      );
    });

    it('redacts query params when sensitive parameters appear at the start of the string', () => {
      expect(
        sanitizeJumiaErrorDetails(
          'code=auth-code-123&client_secret=super-secret&error=invalid_grant'
        )
      ).toBe('code=[REDACTED]&client_secret=[REDACTED]&error=invalid_grant');
    });

    it('serializes BigInt and circular objects without throwing', () => {
      const details: {
        error: string;
        expires_in: bigint;
        self?: unknown;
      } = {
        error: 'invalid_grant',
        expires_in: 3600n,
      };
      details.self = details;

      expect(sanitizeJumiaErrorDetails(details)).toEqual({
        error: 'invalid_grant',
        expires_in: '3600',
        self: '[Circular]',
      });
    });
  });

  describe('getJumiaAuthUrl', () => {
    it('builds correct authorization URL for production', () => {
      const url = getJumiaAuthUrl({
        clientId: 'test-client-id',
        redirectUri: 'https://example.com/callback',
        state: 'abc123',
      });

      expect(url).toContain('https://vendor-api.jumia.com/login?');
      expect(url).toContain('client_id=test-client-id');
      expect(url).toContain(
        `redirect_uri=${encodeURIComponent('https://example.com/callback')}`
      );
      expect(url).toContain('response_type=code');
      expect(new URL(url).searchParams.get('scope')).toBe(
        'openid offline_access'
      );
      expect(url).toContain('prompt=login');
      expect(url).toContain('state=abc123');
    });

    it('uses staging base URL when environment is staging', () => {
      const url = getJumiaAuthUrl({
        clientId: 'test',
        redirectUri: 'https://example.com/cb',
        state: 'xyz',
        environment: 'staging',
      });

      expect(url).toContain('https://vendor-api-staging.jumia.com/login?');
    });

    // VARIANT-TEST: REMOVE — diagnostic harness coverage.
    it.each([
      ['A', 'openid offline_access', 'login', null],
      ['B', 'openid offline_access', 'consent', '0'],
      ['C', 'offline_access openid', 'login', '0'],
      ['D', 'offline_access', 'login', '0'],
      ['E', 'openid offline_access', 'consent', null],
    ] as const)('applies variant %s params to the auth URL', (variantId, expectedScope, expectedPrompt, expectedMaxAge) => {
      const url = getJumiaAuthUrl({
        clientId: 'cid',
        redirectUri: 'https://example.com/cb',
        state: 's',
        variant: variantId,
      });
      const params = new URL(url).searchParams;
      expect(params.get('scope')).toBe(expectedScope);
      expect(params.get('prompt')).toBe(expectedPrompt);
      expect(params.get('max_age')).toBe(expectedMaxAge);
    });
  });

  describe('getJumiaRedirectUri', () => {
    it('returns the callback path when the app URL has no trailing slash', () => {
      expect(getJumiaRedirectUri('https://usebaci.com')).toBe(
        'https://usebaci.com/api/marketplace/jumia/callback'
      );
    });

    it('returns the callback path when the app URL has a single trailing slash', () => {
      expect(getJumiaRedirectUri('https://usebaci.com/')).toBe(
        'https://usebaci.com/api/marketplace/jumia/callback'
      );
    });

    it('normalizes trailing slashes on the app URL', () => {
      expect(getJumiaRedirectUri('https://usebaci.com///')).toBe(
        'https://usebaci.com/api/marketplace/jumia/callback'
      );
    });
  });

  describe('JumiaApiError', () => {
    it('creates error with status and message', () => {
      const err = new JumiaApiError(404, 'Not found');
      expect(err.status).toBe(404);
      expect(err.message).toBe('Jumia API Error (404): Not found');
      expect(err.name).toBe('JumiaApiError');
      expect(err).toBeInstanceOf(Error);
    });

    it('includes details when provided', () => {
      const details = { code: 'INVALID_TOKEN' };
      const err = new JumiaApiError(401, 'Unauthorized', details);
      expect(err.details).toEqual(details);
    });
  });

  describe('exchangeJumiaCode', () => {
    it('exchanges code for tokens successfully', async () => {
      const mockResponse = {
        access_token: 'new-access-token',
        expires_in: 3600,
        refresh_token: 'new-refresh-token',
        refresh_expires_in: 86400,
        token_type: 'Bearer',
      };

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(mockResponse),
        })
      );

      const result = await exchangeJumiaCode({
        code: 'auth-code-123',
        clientId: 'client-id',
        clientSecret: 'client-secret',
        redirectUri: 'https://example.com/callback',
      });

      expect(result.access_token).toBe('new-access-token');
      expect(result.expires_in).toBe(3600);
      expect(result.refresh_token).toBe('new-refresh-token');

      const fetchCall = vi.mocked(fetch).mock.calls[0];
      expect(fetchCall[0]).toBe('https://vendor-api.jumia.com/token');
      expect(fetchCall[1]).toBeDefined();
      expect(fetchCall[1]?.method).toBe('POST');

      // Verify the POST body contains expected OAuth params.
      const rawBody = fetchCall[1]?.body;
      expect(rawBody).toBeDefined();
      const params =
        rawBody instanceof URLSearchParams
          ? rawBody
          : new URLSearchParams(rawBody as string);
      expect(params.get('grant_type')).toBe('authorization_code');
      expect(params.get('code')).toBe('auth-code-123');
      expect(params.get('client_id')).toBe('client-id');
      expect(params.get('client_secret')).toBe('client-secret');
      expect(params.get('redirect_uri')).toBe('https://example.com/callback');
    });

    it('throws JumiaApiError on failed exchange', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 400,
          text: () => Promise.resolve('invalid_grant'),
        })
      );

      await expect(
        exchangeJumiaCode({
          code: 'bad-code',
          clientId: 'client-id',
          clientSecret: 'client-secret',
          redirectUri: 'https://example.com/callback',
        })
      ).rejects.toThrow(JumiaApiError);
    });

    it('includes response body text as details on failed exchange', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 401,
          text: () => Promise.resolve('{"error":"invalid_client"}'),
        })
      );

      await expect(
        exchangeJumiaCode({
          code: 'bad-code',
          clientId: 'client-id',
          clientSecret: 'client-secret',
          redirectUri: 'https://example.com/callback',
        })
      ).rejects.toMatchObject({
        status: 401,
        details: '{"error":"invalid_client"}',
      });
    });

    it('falls back to "Unknown error" when response.text() rejects', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 500,
          text: () => Promise.reject(new Error('stream broken')),
        })
      );

      await expect(
        exchangeJumiaCode({
          code: 'code',
          clientId: 'id',
          clientSecret: 'secret',
          redirectUri: 'https://example.com/cb',
        })
      ).rejects.toMatchObject({
        status: 500,
        details: 'Unknown error',
      });
    });

    it('uses staging URL when environment is staging', async () => {
      const mockResponse = {
        access_token: 'token',
        expires_in: 3600,
        refresh_token: 'refresh',
        refresh_expires_in: 86400,
        token_type: 'Bearer',
      };

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(mockResponse),
        })
      );

      await exchangeJumiaCode({
        code: 'code',
        clientId: 'id',
        clientSecret: 'secret',
        redirectUri: 'https://example.com/cb',
        environment: 'staging',
      });

      const fetchCall = vi.mocked(fetch).mock.calls[0];
      expect(fetchCall[0]).toBe('https://vendor-api-staging.jumia.com/token');
    });

    it('throws JumiaApiError when fetch rejects with a network error', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
      );

      await expect(
        exchangeJumiaCode({
          code: 'code',
          clientId: 'id',
          clientSecret: 'secret',
          redirectUri: 'https://example.com/cb',
        })
      ).rejects.toThrow(JumiaApiError);
    });

    it('throws JumiaApiError with 408 status when request times out', async () => {
      const abortError = new DOMException(
        'The operation was aborted.',
        'AbortError'
      );
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortError));

      await expect(
        exchangeJumiaCode({
          code: 'code',
          clientId: 'id',
          clientSecret: 'secret',
          redirectUri: 'https://example.com/cb',
        })
      ).rejects.toSatisfy((err: unknown) => {
        return err instanceof JumiaApiError && err.status === 408;
      });
    });

    it('passes an AbortSignal to fetch', async () => {
      const mockResponse = {
        access_token: 'token',
        expires_in: 3600,
        refresh_token: 'refresh',
        refresh_expires_in: 86400,
        token_type: 'Bearer',
      };

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(mockResponse),
        })
      );

      await exchangeJumiaCode({
        code: 'code',
        clientId: 'id',
        clientSecret: 'secret',
        redirectUri: 'https://example.com/cb',
      });

      const fetchCall = vi.mocked(fetch).mock.calls[0];
      expect(fetchCall[1]?.signal).toBeInstanceOf(AbortSignal);
    });
  });
});
