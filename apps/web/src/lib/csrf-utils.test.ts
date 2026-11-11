// @vitest-environment jsdom

import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockCookiesGet = vi.fn();
const mockCookiesSet = vi.fn();

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: mockCookiesGet,
    set: mockCookiesSet,
  }),
}));

const originalNodeEnv = process.env.NODE_ENV;

describe('CSRF utility coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCookiesGet.mockReset();
    mockCookiesSet.mockReset();
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    if (originalNodeEnv === undefined) {
      Reflect.deleteProperty(process.env, 'NODE_ENV');
      return;
    }
    Reflect.set(process.env, 'NODE_ENV', originalNodeEnv);
  });

  describe('checkCsrfProtection', () => {
    it('returns valid=true for non-mutating methods', async () => {
      const csrf = await import('./csrf');
      const request = new NextRequest('https://example.com/api/products', {
        method: 'GET',
      });

      const result = await csrf.checkCsrfProtection(request);

      expect(result).toEqual({ valid: true });
    });

    it('skips csrf checks for exempt webhook routes', async () => {
      const csrf = await import('./csrf');
      const request = new NextRequest(
        'https://example.com/api/webhooks/paystack',
        {
          method: 'POST',
        }
      );

      const result = await csrf.checkCsrfProtection(request);

      expect(result).toEqual({ valid: true });
    });

    it('skips csrf checks for bearer authorization regardless of scheme casing', async () => {
      const csrf = await import('./csrf');
      const request = new NextRequest('https://example.com/api/products', {
        headers: { authorization: 'bearer cron-secret' },
        method: 'POST',
      });

      const result = await csrf.checkCsrfProtection(request);

      expect(result).toEqual({ valid: true });
    });

    it('returns 403 response when csrf validation fails', async () => {
      vi.stubEnv('NODE_ENV', 'development');
      const csrf = await import('./csrf');
      const request = new NextRequest('https://example.com/api/products', {
        method: 'POST',
      });

      const result = await csrf.checkCsrfProtection(request);

      expect(result.valid).toBe(false);
      expect(result.response?.status).toBe(403);
      await expect(result.response?.json()).resolves.toMatchObject({
        error: 'Invalid CSRF token',
      });
    });

    it('returns valid=true when csrf validation succeeds', async () => {
      vi.stubEnv('NODE_ENV', 'development');
      const csrf = await import('./csrf');
      const token = 'ok-token';
      const request = new NextRequest('https://example.com/api/products', {
        method: 'POST',
        headers: { [csrf.CSRF_HEADER_NAME]: token },
      });

      vi.spyOn(request.cookies, 'get').mockImplementation(
        (cookieName: string | { name: string }) => {
          const name =
            typeof cookieName === 'string' ? cookieName : cookieName.name;
          return name === 'csrf-token' ? { name, value: token } : undefined;
        }
      );

      const result = await csrf.checkCsrfProtection(request);

      expect(result).toEqual({ valid: true });
    });
  });

  describe('getClientCsrfToken', () => {
    it('returns null during SSR when document is unavailable', async () => {
      const csrf = await import('./csrf');
      const originalDocument = globalThis.document;

      Object.defineProperty(globalThis, 'document', {
        configurable: true,
        value: undefined,
      });
      expect(csrf.getClientCsrfToken()).toBeNull();

      Object.defineProperty(globalThis, 'document', {
        configurable: true,
        value: originalDocument,
      });
    });

    it('prefers __Host-csrf-token over csrf-token on client', async () => {
      vi.stubEnv('NODE_ENV', 'production');
      const csrf = await import('./csrf');
      vi.spyOn(document, 'cookie', 'get').mockReturnValue(
        'csrf-token=legacy-token; __Host-csrf-token=host-token'
      );

      const token = csrf.getClientCsrfToken();

      expect(token).toBe('host-token');
    });
  });

  describe('getCsrfToken', () => {
    it('returns null when no csrf cookie exists', async () => {
      vi.stubEnv('NODE_ENV', 'production');
      mockCookiesGet.mockReturnValue(undefined);
      const csrf = await import('./csrf');

      const token = await csrf.getCsrfToken();

      expect(token).toBeNull();
      expect(mockCookiesGet).toHaveBeenNthCalledWith(1, '__Host-csrf-token');
      expect(mockCookiesGet).toHaveBeenNthCalledWith(2, 'csrf-token');
    });

    it('returns the primary csrf cookie token and does not read fallback', async () => {
      vi.stubEnv('NODE_ENV', 'production');
      mockCookiesGet.mockImplementation((cookieName: string) => {
        if (cookieName === '__Host-csrf-token') {
          return { name: cookieName, value: 'primary-token' };
        }

        return { name: cookieName, value: 'fallback-token' };
      });
      const csrf = await import('./csrf');

      const token = await csrf.getCsrfToken();

      expect(token).toBe('primary-token');
      expect(mockCookiesGet).toHaveBeenCalledTimes(1);
      expect(mockCookiesGet).toHaveBeenCalledWith('__Host-csrf-token');
    });
  });

  describe('buildCsrfHeaders', () => {
    it('does not overwrite an existing csrf header while merging extras', async () => {
      vi.stubEnv('NODE_ENV', 'production');
      const csrf = await import('./csrf');
      vi.spyOn(document, 'cookie', 'get').mockReturnValue(
        '__Host-csrf-token=generated-token'
      );

      const headers = csrf.buildCsrfHeaders({
        'x-csrf-token': 'pre-set-token',
        'Content-Type': 'application/json',
      });

      expect(headers['x-csrf-token']).toBe('pre-set-token');
      expect(headers['Content-Type']).toBe('application/json');
    });

    it('warns and omits csrf header when token is absent', async () => {
      const csrf = await import('./csrf');
      vi.spyOn(document, 'cookie', 'get').mockReturnValue('');
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
        // Intentionally suppress warning output during this assertion.
      });

      const headers = csrf.buildCsrfHeaders({ Accept: 'application/json' });

      expect(headers['x-csrf-token']).toBeUndefined();
      expect(headers.Accept).toBe('application/json');
      expect(warnSpy).toHaveBeenCalledOnce();
    });
  });

  describe('generateCsrfToken', () => {
    it('returns URL-safe base64 without +, /, or = characters', async () => {
      const { generateCsrfToken } = await import('./csrf');
      const token = generateCsrfToken();

      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(token).not.toContain('+');
      expect(token).not.toContain('/');
      expect(token).not.toContain('=');
      expect(token.length).toBeGreaterThanOrEqual(40);
    });

    it('produces high-entropy values across repeated calls', async () => {
      const { generateCsrfToken } = await import('./csrf');
      const values = Array.from({ length: 50 }, () => generateCsrfToken());

      expect(new Set(values).size).toBe(values.length);
    });
  });
});
