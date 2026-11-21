import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { expectPartnerResponse } from '../partner-openapi.test-support';
import { GET } from './route';

const {
  after,
  captureServerEvent,
  loadCrossRemCatalog,
  rateLimit,
  readVersion,
  redis,
  warn,
} = vi.hoisted(() => ({
  after: vi.fn<(callback: () => Promise<unknown>) => void>(),
  captureServerEvent: vi.fn(),
  loadCrossRemCatalog: vi.fn(),
  rateLimit: vi.fn(),
  readVersion: vi.fn(),
  redis: { get: vi.fn(), set: vi.fn(), eval: vi.fn() },
  warn: vi.fn(),
}));

vi.mock('next/server', () => ({ after }));
vi.mock('@/lib/logger', () => ({ logger: { warn } }));
vi.mock('@/lib/posthog/server', () => ({ captureServerEvent }));
vi.mock('@/lib/tenant-rate-limit', () => ({
  checkTenantRateLimitDetailed: rateLimit,
}));
// Exercise the real partner profile, credential scope and snapshot reader.
// Replace only their product, version and Redis dependencies.
vi.mock('./catalog-service', () => ({ loadCrossRemCatalog }));
vi.mock('./catalog-version', () => ({
  readCrossRemCatalogVersion: readVersion,
}));
vi.mock('@/lib/redis', () => ({ getRedis: () => redis }));

const token = 'synthetic-crossrem-access-token-qa-test-0001';
const snapshot = { listings: [{ id: 'google-listed-variant' }] };
const version = '10000000-0000-4000-8000-000000000001';

function request(authorization?: string, ifNoneMatch?: string) {
  const headers = new Headers();

  if (authorization) headers.set('authorization', authorization);
  if (ifNoneMatch) headers.set('if-none-match', ifNoneMatch);
  return new Request('https://store.test/api/partners/v1/catalog', { headers });
}

describe('CrossRem catalog', () => {
  beforeEach(() => {
    vi.stubEnv('CROSSREM_CATALOG_TOKEN', token);
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('VERCEL_DEPLOYMENT_ID', 'dpl_synthetic_snapshot');
    after.mockClear();
    warn.mockClear();
    captureServerEvent.mockReset().mockResolvedValue(true);
    loadCrossRemCatalog.mockReset().mockResolvedValue(snapshot);
    rateLimit.mockReset().mockResolvedValue({ verdict: 'allowed' });
    readVersion.mockReset().mockResolvedValue(version);
    redis.get.mockReset().mockResolvedValue(null);
    redis.set.mockReset().mockResolvedValue('OK');
    redis.eval.mockReset().mockResolvedValue(1);
  });

  it('warns internally when a partner request reaches an unconfigured token', async () => {
    vi.stubEnv('CROSSREM_CATALOG_TOKEN', 'short-placeholder');
    const response = await GET(request(`Bearer ${token}`));

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body).toEqual({
      error: 'Unauthorized',
      request_id: expect.any(String),
    });
    expectPartnerResponse('GET /catalog', 401, body);
    expect(warn).toHaveBeenCalledExactlyOnceWith({
      message: 'Partner catalog credential is unconfigured',
      requestId: body.request_id,
    });
    expect(loadCrossRemCatalog).not.toHaveBeenCalled();
    expect(rateLimit).not.toHaveBeenCalled();
    expect(after).not.toHaveBeenCalled();
  });

  it.each([
    ['denied', 429, '60'],
    ['unavailable', 503, null],
  ])('stops authorized polls before reading the snapshot when rate limit is %s', async (verdict, status, retryAfter) => {
    rateLimit.mockResolvedValueOnce({ verdict });
    const response = await GET(request(`Bearer ${token}`, '*'));
    expect(response.status).toBe(status);
    expect(response.headers.get('retry-after')).toBe(retryAfter);
    expectPartnerResponse('GET /catalog', status, await response.json());
    expect(rateLimit).toHaveBeenCalledExactlyOnceWith(
      'partner-catalog-read',
      'crossrem-ogabassey',
      {
        maxRequests: 120,
        windowMs: 60_000,
      }
    );
    expect(readVersion).not.toHaveBeenCalled();
  });

  it('reports a duplicated token without serving the catalog', async () => {
    vi.stubEnv('CROSSREM_QUOTE_TOKEN', token);
    const response = await GET(request(`Bearer ${token}`));

    expect(response.status).toBe(401);
    expect(warn).toHaveBeenCalledExactlyOnceWith({
      message: 'Partner catalog credential matches multiple grants',
      requestId: expect.any(String),
    });
    expect(loadCrossRemCatalog).not.toHaveBeenCalled();
  });

  afterEach(() => vi.unstubAllEnvs());

  it('distinguishes a valid credential without catalog scope', async () => {
    const quoteToken = 'synthetic-quote-only-credential-for-catalog-test';
    vi.stubEnv('CROSSREM_QUOTE_TOKEN', quoteToken);
    const response = await GET(request(`Bearer ${quoteToken}`, '*'));
    expect(response.status).toBe(403);
    expect(response.headers.has('www-authenticate')).toBe(false);
    expectPartnerResponse('GET /catalog', 403, await response.json());
    expect(rateLimit).not.toHaveBeenCalled();
    expect(readVersion).not.toHaveBeenCalled();
  });

  it('rejects missing, malformed and short configured credentials', async () => {
    for (const configuredToken of ['', 'bad:token', 'test']) {
      vi.stubEnv('CROSSREM_CATALOG_TOKEN', configuredToken);
      const response = await GET(request(`Bearer ${configuredToken || token}`));
      expect(response.status).toBe(401);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
    }
    expect(loadCrossRemCatalog).not.toHaveBeenCalled();
    expect(after).not.toHaveBeenCalled();
  });

  it('checks authentication before loading the feed or applying a validator', async () => {
    for (const authorization of [
      undefined,
      'Bearer incorrect',
      `Bearer x${token.slice(1)}`,
      `Basic ${token}`,
    ]) {
      const response = await GET(request(authorization, '*'));

      expect(response.status).toBe(401);
      expect(response.headers.get('www-authenticate')).toBe('Bearer');
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      expect(response.headers.has('etag')).toBe(false);
    }

    expect(loadCrossRemCatalog).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('returns a complete JSON snapshot and supports conditional reads', async () => {
    const response = await GET(request(`bearer ${token}`));

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-cache');
    expect(response.headers.get('vary')).toBe('Authorization');
    expect(await response.json()).toEqual(snapshot);
    const etag = response.headers.get('etag');
    expect(etag).toMatch(/^"[a-f0-9]{64}"$/);

    const unchanged = await GET(
      request(`Bearer ${token}`, `"other", W/${etag}`)
    );
    expect(unchanged.status).toBe(304);
    expect(unchanged.headers.get('etag')).toBe(etag);
    expect(unchanged.headers.get('cache-control')).toBe('private, no-cache');
    expect(unchanged.headers.get('vary')).toBe('Authorization');
    expect(await unchanged.text()).toBe('');

    loadCrossRemCatalog.mockResolvedValue({ listings: [{ id: 'changed' }] });
    const changed = await GET(request(`Bearer ${token}`, etag ?? undefined));
    expect(changed.status).toBe(200);
    expect(changed.headers.get('etag')).not.toBe(etag);
    expect(await changed.json()).toEqual({ listings: [{ id: 'changed' }] });
    expect(after).not.toHaveBeenCalled();
  });

  it('hides internal details when the catalog cannot be built', async () => {
    loadCrossRemCatalog.mockRejectedValue(new Error('private storage detail'));

    const response = await GET(request(`Bearer ${token}`, '*'));

    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.has('etag')).toBe(false);
    const body = await response.json();
    expect(body).toEqual({
      error: 'CrossRem catalog unavailable',
      request_id: expect.any(String),
    });
    expectPartnerResponse('GET /catalog', 503, body);
    expect(captureServerEvent).not.toHaveBeenCalled();
    expect(after).toHaveBeenCalledTimes(1);
    await after.mock.calls[0]?.[0]();
    expect(captureServerEvent).toHaveBeenCalledExactlyOnceWith(
      'crossrem_catalog_snapshot_unavailable',
      { deployment_environment: 'preview' }
    );
  });
});
