/**
 * Tests for JumiaClient — core API client
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/env', () => ({
  env: { JUMIA_ENVIRONMENT: 'production' },
  getJumiaEnvironment: () => 'production' as const,
  getJumiaClientId: vi.fn(() => 'test-jumia-client-id'),
}));

// ── Mocks ──

const createMockSupabase = vi.hoisted(() => {
  return function createMockSupabase(response: {
    data: unknown;
    error: unknown;
  }) {
    const chainable = {
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue(response),
    };
    Object.defineProperty(chainable, 'then', {
      value(resolve: (v: unknown) => void, reject: (e: unknown) => void) {
        return Promise.resolve(response).then(resolve, reject);
      },
      writable: true,
      enumerable: false,
    });

    return {
      from: vi.fn(() => ({
        select: vi.fn(() => chainable),
        update: vi.fn(() => chainable),
      })),
      _chainable: chainable,
    } as unknown as import('@supabase/supabase-js').SupabaseClient & {
      _chainable: typeof chainable;
    };
  };
});

vi.mock('@/schemas/jumia', async () => {
  const { z } = await vi.importActual<typeof import('zod')>('zod');

  const JumiaTokenResponseSchema = z.object({
    access_token: z.string(),
    expires_in: z.number(),
    refresh_token: z.string(),
    refresh_expires_in: z.number(),
    token_type: z.string(),
  });

  const JumiaShop = z.object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
    businessClients: z.array(
      z.object({
        name: z.string(),
        code: z.string(),
        countryCode: z.string(),
        countryName: z
          .string()
          .optional()
          .transform((value) => value ?? ''),
        status: z.preprocess(
          (value) => (typeof value === 'string' ? value.toLowerCase() : value),
          z.enum(['active', 'inactive', 'pending'])
        ),
        shortCode: z.string(),
      })
    ),
  });

  const JumiaShopsArraySchema = z.array(JumiaShop).min(1);

  const JumiaShopsResponseSchema = z.preprocess(
    (value) => {
      if (Array.isArray(value)) {
        return { shops: value };
      }

      return value;
    },
    z.object({
      shops: JumiaShopsArraySchema,
    })
  );

  return {
    JumiaTokenResponseSchema,
    JumiaShopsResponseSchema,
  };
});

import { JumiaApiError, JumiaClient } from '@/lib/jumia/client';
import {
  MIN_REQUEST_INTERVAL_MS,
  resetJumiaRateLimiterForTests,
} from '@/lib/jumia/jumia-rate-limiter';

// ── Mock helpers ──

function createMockIntegrationRow(overrides?: Record<string, unknown>) {
  return {
    id: 'int-123',
    merchant_id: 'merchant-abc',
    shop_id: 'shop-456',
    shop_name: 'Test Shop',
    country_code: 'NG',
    access_token: 'valid-token',
    refresh_token: 'refresh-tok',
    token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
    is_active: true,
    ...overrides,
  };
}

function createDefaultClient(overrides?: Record<string, unknown>) {
  return new JumiaClient({
    integrationId: 'int-123',
    merchantId: 'merchant-abc',
    shopId: 'shop-456',
    marketplaceKey: 'default',
    accessToken: 'valid-token',
    refreshToken: 'refresh-tok',
    tokenExpiresAt: new Date(Date.now() + 3600_000),
    environment: 'production',
    ...overrides,
  });
}

// ── Token refresh response ──

const TOKEN_RESPONSE = {
  access_token: 'new-access-token',
  expires_in: 3600,
  refresh_token: 'new-refresh-token',
  refresh_expires_in: 86400,
  token_type: 'Bearer',
};

// ── Tests ──

describe('JumiaClient', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    globalThis.fetch = vi.fn();
    resetJumiaRateLimiterForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.fetch = originalFetch;
    resetJumiaRateLimiterForTests();
    vi.restoreAllMocks();
  });

  // ── Constructor ──

  describe('constructor', () => {
    it('sets all fields correctly and defaults environment to production', () => {
      const now = new Date();
      const client = new JumiaClient({
        integrationId: 'int-1',
        merchantId: 'm-1',
        shopId: 's-1',
        marketplaceKey: 'default',
        accessToken: 'tok',
        refreshToken: 'ref',
        tokenExpiresAt: now,
      });

      expect(client.integrationId).toBe('int-1');
      expect(client.merchantId).toBe('m-1');
      expect(client.shopId).toBe('s-1');
      // environment defaults to production, verified via apiBase
      expect(client.apiBase).toBe('https://vendor-api.jumia.com');
    });

    it('accepts explicit environment override', () => {
      const client = new JumiaClient({
        integrationId: 'int-1',
        merchantId: 'm-1',
        shopId: 's-1',
        marketplaceKey: 'default',
        accessToken: null,
        refreshToken: 'ref',
        tokenExpiresAt: null,
        environment: 'staging',
      });

      expect(client.apiBase).toBe('https://vendor-api-staging.jumia.com');
    });
  });

  // ── apiBase ──

  describe('apiBase', () => {
    it('returns production URL for production environment', () => {
      const client = createDefaultClient({ environment: 'production' });
      expect(client.apiBase).toBe('https://vendor-api.jumia.com');
    });

    it('returns staging URL for staging environment', () => {
      const client = createDefaultClient({ environment: 'staging' });
      expect(client.apiBase).toBe('https://vendor-api-staging.jumia.com');
    });
  });

  // ── forIntegration() ──

  describe('forIntegration()', () => {
    it('returns a JumiaClient with correct fields on success', async () => {
      const row = createMockIntegrationRow();
      const supabase = createMockSupabase({ data: row, error: null });

      const client = await JumiaClient.forIntegration(
        supabase,
        'merchant-abc',
        'int-123'
      );

      expect(client).toBeInstanceOf(JumiaClient);
      expect(client.integrationId).toBe('int-123');
      expect(client.merchantId).toBe('merchant-abc');
      expect(client.shopId).toBe('shop-456');

      // Verify query was scoped correctly
      expect(supabase.from).toHaveBeenCalledWith('marketplace_integrations');
      const chain = supabase._chainable;
      expect(chain.eq).toHaveBeenCalledWith('id', 'int-123');
      expect(chain.eq).toHaveBeenCalledWith('merchant_id', 'merchant-abc');
      expect(chain.eq).toHaveBeenCalledWith('platform', 'jumia');
      expect(chain.eq).toHaveBeenCalledWith('is_active', true);
      expect(chain.single).toHaveBeenCalled();
    });

    it('throws JumiaApiError(404) when row does not exist', async () => {
      const supabase = createMockSupabase({
        data: null,
        error: { message: 'Row not found', code: 'PGRST116' },
      });

      const error = await JumiaClient.forIntegration(
        supabase,
        'merchant-abc',
        'int-999'
      ).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(JumiaApiError);
      expect((error as JumiaApiError).status).toBe(404);
      expect((error as JumiaApiError).message).toMatch(/not found/i);
    });

    it('throws when integrationId belongs to a different merchant', async () => {
      // The .eq('merchant_id', ...) filter causes supabase to return no rows
      const supabase = createMockSupabase({
        data: null,
        error: { message: 'Row not found', code: 'PGRST116' },
      });

      await expect(
        JumiaClient.forIntegration(supabase, 'wrong-merchant', 'int-123')
      ).rejects.toThrow(JumiaApiError);
    });

    it('uses "oauth" as shopId when shop_id is null', async () => {
      const row = createMockIntegrationRow({ shop_id: null });
      const supabase = createMockSupabase({ data: row, error: null });

      const client = await JumiaClient.forIntegration(
        supabase,
        'merchant-abc',
        'int-123'
      );

      expect(client.shopId).toBe('oauth');
    });
  });

  // ── forMerchant() ──

  describe('forMerchant()', () => {
    it('succeeds with a single active integration', async () => {
      const row = createMockIntegrationRow();
      const supabase = createMockSupabase({ data: [row], error: null });

      const client = await JumiaClient.forMerchant(supabase, 'merchant-abc');

      expect(client).toBeInstanceOf(JumiaClient);
      expect(client.integrationId).toBe('int-123');
      expect(client.merchantId).toBe('merchant-abc');
    });

    it('throws JumiaApiError(400) when multiple active integrations exist', async () => {
      const row1 = createMockIntegrationRow({ id: 'int-1' });
      const row2 = createMockIntegrationRow({ id: 'int-2' });
      const supabase = createMockSupabase({
        data: [row1, row2],
        error: null,
      });

      const error = await JumiaClient.forMerchant(
        supabase,
        'merchant-abc'
      ).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(JumiaApiError);
      expect((error as JumiaApiError).status).toBe(400);
      expect((error as JumiaApiError).message).toMatch(/multiple active/i);
      expect((error as JumiaApiError).message).toMatch(/forIntegration/);
    });

    it('throws JumiaApiError(404) when no active integration exists', async () => {
      const supabase = createMockSupabase({ data: [], error: null });

      const error = await JumiaClient.forMerchant(
        supabase,
        'merchant-abc'
      ).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(JumiaApiError);
      expect((error as JumiaApiError).status).toBe(404);
      expect((error as JumiaApiError).message).toMatch(/no active/i);
    });

    it('throws JumiaApiError(404) when supabase returns an error', async () => {
      const supabase = createMockSupabase({
        data: null,
        error: { message: 'DB error' },
      });

      const error = await JumiaClient.forMerchant(
        supabase,
        'merchant-abc'
      ).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(JumiaApiError);
      expect((error as JumiaApiError).status).toBe(404);
    });
  });

  // ── getValidToken() ──

  describe('getValidToken()', () => {
    it('returns existing token when not expired', async () => {
      const client = createDefaultClient();

      const token = await client.getValidToken();

      expect(token).toBe('valid-token');
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('triggers refresh when token is expired', async () => {
      const supabase = createMockSupabase({ data: null, error: null });
      const client = new JumiaClient({
        integrationId: 'int-123',
        merchantId: 'merchant-abc',
        shopId: 'shop-456',
        marketplaceKey: 'default',
        accessToken: 'expired-token',
        refreshToken: 'refresh-tok',
        tokenExpiresAt: new Date(Date.now() - 1000), // already expired
        environment: 'production',
        supabase,
      });

      const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>;
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => TOKEN_RESPONSE,
      });

      const token = await client.getValidToken();

      expect(token).toBe('new-access-token');
      expect(mockFetch).toHaveBeenCalledTimes(1);
      // Verify token refresh endpoint was called
      expect(mockFetch.mock.calls[0][0]).toBe(
        'https://vendor-api.jumia.com/token'
      );

      // Verify Supabase was called to persist the new tokens
      const fromCall = supabase.from as ReturnType<typeof vi.fn>;
      expect(fromCall).toHaveBeenCalledWith('marketplace_integrations');
      const updateFn = fromCall.mock.results[0]?.value?.update;
      expect(updateFn).toHaveBeenCalledWith(
        expect.objectContaining({
          access_token: 'new-access-token',
          refresh_token: 'new-refresh-token',
        })
      );
      expect(mockFetch.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
    });

    it('triggers refresh when accessToken is null', async () => {
      const supabase = createMockSupabase({ data: null, error: null });
      const client = new JumiaClient({
        integrationId: 'int-123',
        merchantId: 'merchant-abc',
        shopId: 'shop-456',
        marketplaceKey: 'default',
        accessToken: null,
        refreshToken: 'refresh-tok',
        tokenExpiresAt: null,
        environment: 'production',
        supabase,
      });

      const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>;
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => TOKEN_RESPONSE,
      });

      const token = await client.getValidToken();

      expect(token).toBe('new-access-token');
    });

    it('does not fall back to an admin client when token refresh needs persistence', async () => {
      const client = new JumiaClient({
        integrationId: 'int-123',
        merchantId: 'merchant-abc',
        shopId: 'shop-456',
        marketplaceKey: 'default',
        accessToken: 'expired-token',
        refreshToken: 'refresh-tok',
        tokenExpiresAt: new Date(Date.now() - 1000),
        environment: 'production',
      });

      const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>;
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => TOKEN_RESPONSE,
      });

      await expect(client.getValidToken()).rejects.toMatchObject({
        status: 500,
        message: expect.stringContaining('Scoped Supabase client is required'),
      });
    });

    it('records a reauthorization sync error when an expired OAuth token has no refresh token', async () => {
      const supabase = createMockSupabase({ data: null, error: null });
      const client = new JumiaClient({
        integrationId: 'int-123',
        merchantId: 'merchant-abc',
        shopId: 'shop-456',
        marketplaceKey: 'default',
        accessToken: 'expired-token',
        refreshToken: '',
        tokenExpiresAt: new Date(Date.now() - 1000),
        environment: 'production',
        supabase,
      });

      await expect(client.getValidToken()).rejects.toMatchObject({
        status: 401,
        message: expect.stringContaining('Reconnect Jumia'),
      });

      expect(globalThis.fetch).not.toHaveBeenCalled();
      const fromCall = supabase.from as ReturnType<typeof vi.fn>;
      expect(fromCall).toHaveBeenCalledWith('marketplace_integrations');
      const updateFn = fromCall.mock.results[0]?.value?.update;
      expect(updateFn).toHaveBeenCalledWith({
        sync_error:
          'Reconnect Jumia to resume syncing. Jumia did not return a refresh token for this OAuth connection.',
      });
      const chain = supabase._chainable;
      expect(chain.eq).toHaveBeenCalledWith('id', 'int-123');
      expect(chain.eq).toHaveBeenCalledWith('merchant_id', 'merchant-abc');
    });

    it('triggers refresh when token is within the buffer window', async () => {
      const supabase = createMockSupabase({ data: null, error: null });
      // Token expires in 2 minutes, but buffer is 5 minutes, so needs refresh
      const client = new JumiaClient({
        integrationId: 'int-123',
        merchantId: 'merchant-abc',
        shopId: 'shop-456',
        marketplaceKey: 'default',
        accessToken: 'soon-expired',
        refreshToken: 'refresh-tok',
        tokenExpiresAt: new Date(Date.now() + 2 * 60 * 1000),
        environment: 'production',
        supabase,
      });

      const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>;
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => TOKEN_RESPONSE,
      });

      const token = await client.getValidToken();

      expect(token).toBe('new-access-token');
    });

    it('throws a timeout error when token refresh is aborted', async () => {
      const supabase = createMockSupabase({ data: null, error: null });
      const client = new JumiaClient({
        integrationId: 'int-123',
        merchantId: 'merchant-abc',
        shopId: 'shop-456',
        marketplaceKey: 'default',
        accessToken: 'expired-token',
        refreshToken: 'refresh-tok',
        tokenExpiresAt: new Date(Date.now() - 1000),
        environment: 'production',
        supabase,
      });

      const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>;
      mockFetch.mockRejectedValueOnce(
        new DOMException('The operation was aborted.', 'AbortError')
      );

      await expect(client.getValidToken()).rejects.toMatchObject({
        status: 408,
        message: 'Jumia API Error (408): Token refresh request timed out',
      });
    });
  });

  // ── request() ──

  describe('request()', () => {
    it('makes GET request with Bearer token and returns parsed response', async () => {
      const client = createDefaultClient();
      const responseBody = { result: 'ok' };

      const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>;
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => responseBody,
      });

      const result = await client.request('GET', '/some-endpoint');

      expect(result).toEqual(responseBody);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe('https://vendor-api.jumia.com/some-endpoint');
      expect(options.method).toBe('GET');
      expect(options.headers.Authorization).toBe('Bearer valid-token');
      expect(options.headers['Content-Type']).toBe('application/json');
      expect(options.headers.Accept).toBe('application/json');
    });

    it('auto-retries on 401 with refreshed token', async () => {
      const supabase = createMockSupabase({ data: null, error: null });
      const client = new JumiaClient({
        integrationId: 'int-123',
        merchantId: 'merchant-abc',
        shopId: 'shop-456',
        marketplaceKey: 'default',
        accessToken: 'stale-token',
        refreshToken: 'refresh-tok',
        tokenExpiresAt: new Date(Date.now() + 3600_000),
        environment: 'production',
        supabase,
      });

      const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>;

      // 1st call: the API request returns 401
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
      });

      // 2nd call: token refresh succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => TOKEN_RESPONSE,
      });

      // 3rd call: retry of original request succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ retried: true }),
      });

      const result = await client.request('GET', '/protected');

      expect(result).toEqual({ retried: true });
      expect(mockFetch).toHaveBeenCalledTimes(3);

      // Verify the retry used the new token
      const retryCall = mockFetch.mock.calls[2];
      expect(retryCall[1].headers.Authorization).toBe(
        'Bearer new-access-token'
      );
    });

    it('throws JumiaApiError on non-OK response without retry', async () => {
      const supabase = createMockSupabase({ data: null, error: null });
      const client = new JumiaClient({
        integrationId: 'int-123',
        merchantId: 'merchant-abc',
        shopId: 'shop-456',
        marketplaceKey: 'default',
        accessToken: 'token',
        refreshToken: 'refresh-tok',
        tokenExpiresAt: new Date(Date.now() + 3600_000),
        environment: 'production',
        supabase,
      });

      const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>;
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      });

      const error = await client
        .request('GET', '/failing')
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(JumiaApiError);
      expect((error as JumiaApiError).message).toContain(
        'Internal Server Error'
      );
      expect((error as JumiaApiError).status).toBe(500);
    });

    it('sends JSON body for POST requests', async () => {
      const client = createDefaultClient();

      const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>;
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ created: true }),
      });

      await client.request('POST', '/items', undefined, { name: 'Test' });

      const [, options] = mockFetch.mock.calls[0];
      expect(options.body).toBe(JSON.stringify({ name: 'Test' }));
    });

    it('throttles rapid sequential requests to respect 4 req/sec limit', async () => {
      const client = createDefaultClient();
      const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>;
      const okResponse = {
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
      };

      mockFetch.mockResolvedValue(okResponse);

      const start = Date.now();
      await client.request('GET', '/a');
      await client.request('GET', '/b');
      await client.request('GET', '/c');
      const elapsed = Date.now() - start;

      expect(elapsed).toBeGreaterThanOrEqual(MIN_REQUEST_INTERVAL_MS * 2 - 50);
      expect(elapsed).toBeLessThan(700);
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('serializes concurrent requests through the throttle gate', async () => {
      const client = createDefaultClient();
      const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>;
      const callTimes: number[] = [];

      mockFetch.mockImplementation(() => {
        callTimes.push(Date.now());
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true }),
        };
      });

      await Promise.all([
        client.request('GET', '/a'),
        client.request('GET', '/b'),
        client.request('GET', '/c'),
      ]);

      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(callTimes[1] - callTimes[0]).toBeGreaterThanOrEqual(200);
      expect(callTimes[2] - callTimes[1]).toBeGreaterThanOrEqual(200);
    });

    it('serializes requests across client instances for the same merchant', async () => {
      const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>;
      const callTimes: number[] = [];
      const clients = [
        createDefaultClient({ integrationId: 'int-1' }),
        createDefaultClient({ integrationId: 'int-2' }),
        createDefaultClient({ integrationId: 'int-3' }),
      ];

      mockFetch.mockImplementation(() => {
        callTimes.push(Date.now());
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true }),
        };
      });

      await Promise.all(
        clients.map((client, index) => client.request('GET', `/shops/${index}`))
      );

      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(callTimes[1] - callTimes[0]).toBeGreaterThanOrEqual(200);
      expect(callTimes[2] - callTimes[1]).toBeGreaterThanOrEqual(200);
    });

    it('applies throttling to the retried request after a 401', async () => {
      const supabase = createMockSupabase({ data: null, error: null });
      const client = new JumiaClient({
        integrationId: 'int-123',
        merchantId: 'merchant-abc',
        shopId: 'shop-456',
        marketplaceKey: 'default',
        accessToken: 'stale-token',
        refreshToken: 'refresh-tok',
        tokenExpiresAt: new Date(Date.now() + 3600_000),
        environment: 'production',
        supabase,
      });

      const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>;
      const callTimes: number[] = [];
      let protectedCallCount = 0;

      mockFetch.mockImplementation((input: RequestInfo | URL) => {
        callTimes.push(Date.now());

        if (String(input).endsWith('/protected')) {
          protectedCallCount += 1;
          if (protectedCallCount === 1) {
            return {
              ok: false,
              status: 401,
              text: async () => 'Unauthorized',
            };
          }

          return {
            ok: true,
            status: 200,
            json: async () => ({ retried: true }),
          };
        }

        return {
          ok: true,
          status: 200,
          json: async () => TOKEN_RESPONSE,
        };
      });

      const result = await client.request('GET', '/protected');

      expect(result).toEqual({ retried: true });
      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(callTimes[1] - callTimes[0]).toBeGreaterThanOrEqual(200);
      expect(callTimes[2] - callTimes[1]).toBeGreaterThanOrEqual(200);
    });
  });

  // ── getShops() ──

  describe('getShops()', () => {
    it('returns shop list from /shops endpoint', async () => {
      const client = createDefaultClient();
      const shopsResponse = {
        shops: [
          {
            id: 'shop-1',
            name: 'My Shop',
            email: 'shop@example.com',
            businessClients: [
              {
                name: 'Jumia NG',
                code: 'jumia_ng',
                countryCode: 'NG',
                countryName: 'Nigeria',
                status: 'active',
                shortCode: 'NG',
              },
            ],
          },
        ],
      };

      const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>;
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => shopsResponse,
      });

      const shops = await client.getShops();

      expect(shops).toHaveLength(1);
      expect(shops[0].id).toBe('shop-1');
      expect(shops[0].name).toBe('My Shop');
    });

    it('returns shop list when /shops responds with a bare array', async () => {
      const client = createDefaultClient();
      const shopsResponse = [
        {
          id: 'shop-1',
          name: 'My Shop',
          email: 'shop@example.com',
          businessClients: [
            {
              name: 'Jumia NG',
              code: 'jumia_ng',
              countryCode: 'NG',
              countryName: 'Nigeria',
              status: 'active',
              shortCode: 'NG',
            },
          ],
        },
      ];

      const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>;
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => shopsResponse,
      });

      const shops = await client.getShops();

      expect(shops).toHaveLength(1);
      expect(shops[0].id).toBe('shop-1');
    });

    it('normalizes uppercase status and missing country name from /shops', async () => {
      const client = createDefaultClient();
      const shopsResponse = {
        shops: [
          {
            id: 'shop-1',
            name: 'My Shop',
            email: 'shop@example.com',
            businessClients: [
              {
                name: 'Jumia NG',
                code: 'jumia_ng',
                countryCode: 'NG',
                status: 'ACTIVE',
                shortCode: 'NG',
              },
            ],
          },
        ],
      };

      const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>;
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => shopsResponse,
      });

      const shops = await client.getShops();

      expect(shops[0].businessClients[0].countryName).toBe('');
      expect(shops[0].businessClients[0].status).toBe('active');
    });

    it('rethrows error on API failure', async () => {
      const client = createDefaultClient();

      const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>;
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Server error',
      });

      const error = await client.getShops().catch((e: unknown) => e);
      expect(error).toBeInstanceOf(JumiaApiError);
      expect((error as JumiaApiError).message).toContain('Server error');
      expect((error as JumiaApiError).status).toBe(500);
    });

    it('rethrows error when fetch throws a network error', async () => {
      const client = createDefaultClient();

      const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>;
      mockFetch.mockRejectedValueOnce(new Error('Network failure'));

      await expect(client.getShops()).rejects.toThrow('Network failure');
    });
  });
});
