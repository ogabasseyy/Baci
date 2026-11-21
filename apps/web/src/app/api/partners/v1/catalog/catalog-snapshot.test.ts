import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, maxDuration } from './route';

const {
  after,
  captureServerEvent,
  loadCrossRemCatalog,
  readVersion,
  redis,
  warn,
} = vi.hoisted(() => ({
  after: vi.fn<(callback: () => Promise<unknown>) => void>(),
  captureServerEvent: vi.fn(),
  loadCrossRemCatalog: vi.fn(),
  readVersion: vi.fn(),
  redis: { get: vi.fn(), set: vi.fn(), eval: vi.fn() },
  warn: vi.fn(),
}));

vi.mock('next/server', () => ({ after }));
vi.mock('@/lib/logger', () => ({ logger: { warn } }));
vi.mock('@/lib/posthog/server', () => ({ captureServerEvent }));
vi.mock('./catalog-service', () => ({ loadCrossRemCatalog }));
vi.mock('./catalog-version', () => ({
  readCrossRemCatalogVersion: readVersion,
}));
vi.mock('@/lib/redis', () => ({ getRedis: () => redis }));
vi.mock('@/lib/tenant-rate-limit', () => ({
  checkTenantRateLimitDetailed: async () => ({ verdict: 'allowed' }),
}));

const token = 'synthetic-crossrem-access-token-qa-test-0001';
const snapshot = { listings: [{ id: 'google-listed-variant' }] };
const version = '10000000-0000-4000-8000-000000000001';
const nextVersion = '10000000-0000-4000-8000-000000000002';
const etag = `"${createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')}"`;

function request(authorization?: string, ifNoneMatch?: string) {
  const headers = new Headers();

  if (authorization) headers.set('authorization', authorization);
  if (ifNoneMatch) headers.set('if-none-match', ifNoneMatch);
  return new Request('https://store.test/api/partners/v1/catalog', { headers });
}

describe('CrossRem snapshot route', () => {
  beforeEach(() => {
    vi.stubEnv('CROSSREM_CATALOG_TOKEN', token);
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('VERCEL_DEPLOYMENT_ID', 'dpl_synthetic_snapshot');
    after.mockClear();
    warn.mockClear();
    captureServerEvent.mockReset().mockResolvedValue(true);
    loadCrossRemCatalog.mockReset().mockResolvedValue(snapshot);
    readVersion.mockReset().mockResolvedValue(version);
    redis.get.mockReset().mockResolvedValue(null);
    redis.set.mockReset().mockResolvedValue('OK');
    redis.eval.mockReset().mockResolvedValue(1);
  });

  afterEach(() => vi.unstubAllEnvs());

  it('answers an unchanged poll using only the version and published validator', async () => {
    redis.get.mockResolvedValueOnce({ version, etag });
    const response = await GET(request(`Bearer ${token}`, `W/${etag}`));

    expect(response.status).toBe(304);
    expect(await response.text()).toBe('');
    expect(response.headers.get('etag')).toBe(etag);
    expect(readVersion).toHaveBeenCalledTimes(2);
    expect(redis.get).toHaveBeenCalledTimes(1);
    expect(loadCrossRemCatalog).not.toHaveBeenCalled();
  });

  it('rebuilds a changed version and returns 503 for an incomplete snapshot even with a wildcard', async () => {
    readVersion.mockResolvedValue(nextVersion);
    redis.get.mockResolvedValueOnce({ version, etag });
    loadCrossRemCatalog.mockRejectedValue(new Error('Incomplete catalog'));
    const response = await GET(request(`Bearer ${token}`, '*'));

    expect(response.status).toBe(503);
    expect(response.headers.has('etag')).toBe(false);
    expect(loadCrossRemCatalog).toHaveBeenCalledOnce();
    expect(redis.eval.mock.calls.every((call) => call[1].length === 1)).toBe(
      true
    );
  });

  it('discards a build when the catalog changes during source reads', async () => {
    readVersion
      .mockResolvedValueOnce(version)
      .mockResolvedValueOnce(nextVersion);
    const response = await GET(request(`Bearer ${token}`, etag));

    expect(response.status).toBe(503);
    expect(redis.eval.mock.calls.every((call) => call[1].length === 1)).toBe(
      true
    );
  });

  it('returns 503 when a rebuild becomes stale during Redis publication', async () => {
    readVersion
      .mockResolvedValueOnce(version)
      .mockResolvedValueOnce(version)
      .mockResolvedValueOnce(nextVersion);
    const response = await GET(request(`Bearer ${token}`));
    expect(response.status).toBe(503);
    expect(response.headers.has('etag')).toBe(false);
    expect(
      redis.eval.mock.calls.filter((call) => call[1].length === 3)
    ).toHaveLength(1);
  });

  it('round-trips a stored snapshot and publishes the new body after a version change', async () => {
    const cache = new Map();
    redis.get.mockImplementation(async (key) => cache.get(key));
    redis.eval.mockImplementation(async (_script, keys, args) => {
      if (keys.length === 3) {
        cache.set(keys[1], JSON.parse(args[1]));
        cache.set(keys[2], args[2]);
      }
      return 1;
    });

    const initial = await GET(request(`Bearer ${token}`));
    expect(initial.status).toBe(200);
    expect(await initial.json()).toEqual(snapshot);

    const cached = await GET(request(`Bearer ${token}`));
    expect(cached.status).toBe(200);
    expect(await cached.json()).toEqual(snapshot);
    expect(loadCrossRemCatalog).toHaveBeenCalledTimes(1);

    const changed = { listings: [{ id: 'new-listing' }] };
    readVersion.mockResolvedValue(nextVersion);
    loadCrossRemCatalog.mockResolvedValueOnce(changed);
    const fresh = await GET(request(`Bearer ${token}`, etag));
    expect(fresh.status).toBe(200);
    expect(await fresh.json()).toEqual(changed);
    expect(fresh.headers.get('etag')).not.toBe(etag);
    expect(cache.size).toBe(2);
  });

  it('falls back to validation when Redis or its stored body is unavailable', async () => {
    redis.get
      .mockResolvedValueOnce({ version, etag })
      .mockResolvedValueOnce('invalid');
    expect((await GET(request(`Bearer ${token}`))).status).toBe(200);
    expect(loadCrossRemCatalog).toHaveBeenCalledTimes(1);

    redis.get.mockRejectedValueOnce(new Error('cache unavailable'));
    expect((await GET(request(`Bearer ${token}`, etag))).status).toBe(304);
    expect(loadCrossRemCatalog).toHaveBeenCalledTimes(2);
  });

  it('returns 503 when it cannot confirm the current version', async () => {
    readVersion.mockRejectedValueOnce(new Error('version unavailable'));
    const response = await GET(request(`Bearer ${token}`, etag));
    expect(response.status).toBe(503);
    expect(redis.get).not.toHaveBeenCalled();
    expect(loadCrossRemCatalog).not.toHaveBeenCalled();
  });

  it('rejects a cache hit if the revision changed during the Redis read', async () => {
    redis.get.mockResolvedValueOnce({ version, etag });
    readVersion
      .mockResolvedValueOnce(version)
      .mockResolvedValueOnce(nextVersion);
    expect((await GET(request(`Bearer ${token}`, etag))).status).toBe(503);
    expect(loadCrossRemCatalog).not.toHaveBeenCalled();
  });

  it('shares an in-flight build without Redis and applies each request validator', async () => {
    vi.stubEnv('VERCEL_DEPLOYMENT_ID', '');
    vi.stubEnv('CROSSREM_CATALOG_CACHE_DEPLOYMENT_ID', '');
    const build = Promise.withResolvers<typeof snapshot>();
    loadCrossRemCatalog.mockReturnValue(build.promise);
    const full = GET(request(`Bearer ${token}`));
    const conditional = GET(request(`Bearer ${token}`, etag));
    await vi.waitFor(() => expect(readVersion).toHaveBeenCalledTimes(2));
    build.resolve(snapshot);
    expect((await full).status).toBe(200);
    expect((await conditional).status).toBe(304);
    expect(loadCrossRemCatalog).toHaveBeenCalledOnce();
    expect(redis.get).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledExactlyOnceWith({
      message: 'CrossRem shared snapshot cache disabled',
      reason: 'deployment ID missing',
    });
  });

  it('returns promptly when a concurrent build published only the validator', async () => {
    redis.get.mockResolvedValue({ version, etag, bodyCached: false });
    redis.set.mockResolvedValue(null);
    expect((await GET(request(`Bearer ${token}`))).status).toBe(503);
    expect(redis.get).toHaveBeenCalledTimes(2);
    expect(loadCrossRemCatalog).not.toHaveBeenCalled();
    expect(redis.set.mock.calls[0]?.[2].ex).toBeGreaterThan(maxDuration);
    expect((await GET(request(`Bearer ${token}`, etag))).status).toBe(304);
  });

  it('uses a consistent configured cache scope and isolates different releases', async () => {
    vi.stubEnv('VERCEL_DEPLOYMENT_ID', '');
    vi.stubEnv('CROSSREM_CATALOG_CACHE_DEPLOYMENT_ID', 'sandbox-release-a');
    redis.get.mockResolvedValue({ version, etag });
    const poll = request(`Bearer ${token}`, etag);
    expect((await GET(poll)).status).toBe(304);
    expect((await GET(poll)).status).toBe(304);
    expect(redis.get.mock.calls[0]?.[0]).toBe(redis.get.mock.calls[1]?.[0]);

    vi.stubEnv('CROSSREM_CATALOG_CACHE_DEPLOYMENT_ID', 'sandbox-release-b');
    expect((await GET(poll)).status).toBe(304);
    expect(redis.get.mock.calls[2]?.[0]).not.toBe(redis.get.mock.calls[0]?.[0]);
  });

  it('makes overlapping misses wait for one revision-checked publication', async () => {
    const cache = new Map<string, unknown>();
    redis.get.mockImplementation(async (key) => cache.get(key) ?? null);
    redis.set.mockImplementation(async (key, value, options) => {
      if (options?.nx && cache.has(key)) return null;
      cache.set(key, value);
      return 'OK';
    });
    redis.eval.mockImplementation(async (_script, keys, args) => {
      if (cache.get(keys[0]) !== args[0]) return 0;
      if (keys.length === 3) {
        cache.set(keys[1], JSON.parse(args[1]));
        cache.set(keys[2], args[2]);
      }
      cache.delete(keys[0]);
      return 1;
    });
    const pendingBuild = Promise.withResolvers<typeof snapshot>();
    loadCrossRemCatalog.mockReturnValueOnce(pendingBuild.promise);
    const leader = GET(request(`Bearer ${token}`));
    await vi.waitFor(() => expect(loadCrossRemCatalog).toHaveBeenCalledOnce());
    const follower = GET(request(`Bearer ${token}`, etag));
    await vi.waitFor(() => expect(redis.set).toHaveBeenCalledTimes(2));
    pendingBuild.resolve(snapshot);

    expect((await leader).status).toBe(200);
    expect((await follower).status).toBe(304);
    expect(loadCrossRemCatalog).toHaveBeenCalledOnce();
    expect(
      redis.eval.mock.calls.filter((call) => call[1].length === 3)
    ).toHaveLength(1);
  });
});
