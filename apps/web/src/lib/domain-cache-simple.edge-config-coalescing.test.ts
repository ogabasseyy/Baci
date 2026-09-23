import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockEdgeGet = vi.fn();
vi.mock('@vercel/edge-config', () => ({
  get: (...args: unknown[]) => mockEdgeGet(...args),
}));

const mockMaybeSingle = vi.fn();
const mockLimit = vi.fn(() => ({ maybeSingle: mockMaybeSingle }));
const mockEq = vi.fn();
mockEq.mockImplementation(() => ({
  eq: mockEq,
  limit: mockLimit,
  maybeSingle: mockMaybeSingle,
}));
const mockSelect = vi.fn(() => ({ eq: mockEq }));
const mockFrom = vi.fn(() => ({ select: mockSelect }));

vi.mock('./supabase/admin', () => ({
  createAdminClient: () => ({ from: mockFrom }),
}));

const {
  getCustomDomainForSlug,
  getSlugForCustomDomain,
  invalidateForwardDomainCacheForSlug,
  invalidateReverseDomainCacheForDomain,
  invalidateReverseDomainCacheForSlug,
} = await import('./domain-cache-simple');

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mockEdgeGet.mockReset();
  mockMaybeSingle.mockReset();
  mockLimit.mockReset().mockReturnValue({ maybeSingle: mockMaybeSingle });
  mockEq.mockReset().mockImplementation(() => ({
    eq: mockEq,
    limit: mockLimit,
    maybeSingle: mockMaybeSingle,
  }));
  mockSelect.mockReset().mockReturnValue({ eq: mockEq });
  mockFrom.mockReset().mockReturnValue({ select: mockSelect });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Edge Config read coalescing', () => {
  it('shares only concurrent normalized forward reads', async () => {
    let resolve: ((value: string) => void) | undefined;
    const providerRead = new Promise<string>((done) => {
      resolve = done;
    });
    mockEdgeGet.mockReturnValueOnce(providerRead);

    const first = getCustomDomainForSlug(' OGABASSEY ');
    const second = getCustomDomainForSlug('ogabassey');
    resolve?.('ogabassey.com');

    await expect(Promise.all([first, second])).resolves.toEqual([
      'ogabassey.com',
      'ogabassey.com',
    ]);
    expect(mockEdgeGet).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(60_001);
    mockEdgeGet.mockResolvedValueOnce('fresh.ogabassey.com');
    await expect(getCustomDomainForSlug('ogabassey')).resolves.toBe(
      'fresh.ogabassey.com'
    );
    expect(mockEdgeGet).toHaveBeenCalledTimes(2);
  });

  it('reuses a positive Edge Config mapping for the warm-instance TTL', async () => {
    mockEdgeGet.mockResolvedValue('warm-edge.com');

    await expect(getCustomDomainForSlug('warm-edge')).resolves.toBe(
      'warm-edge.com'
    );
    await expect(getCustomDomainForSlug('warm-edge')).resolves.toBe(
      'warm-edge.com'
    );

    expect(mockEdgeGet).toHaveBeenCalledTimes(1);
  });

  it('does not cache a forward result that resolves after invalidation', async () => {
    let resolve: ((value: string) => void) | undefined;
    mockEdgeGet.mockReturnValueOnce(new Promise<string>((r) => (resolve = r)));
    const pending = getCustomDomainForSlug('race-forward');
    invalidateForwardDomainCacheForSlug('race-forward');
    resolve?.('old.example.com');
    await expect(pending).resolves.toBe('old.example.com');
    mockEdgeGet.mockResolvedValueOnce('new.example.com');
    await expect(getCustomDomainForSlug('race-forward')).resolves.toBe(
      'new.example.com'
    );
    expect(mockEdgeGet).toHaveBeenCalledTimes(2);
  });

  it('keeps generation fences monotonic when a key is evicted and reused', async () => {
    invalidateForwardDomainCacheForSlug('aba-forward');
    let resolve: ((value: string) => void) | undefined;
    mockEdgeGet.mockReturnValueOnce(new Promise<string>((r) => (resolve = r)));
    const pending = getCustomDomainForSlug('aba-forward');
    invalidateForwardDomainCacheForSlug('aba-forward');
    for (let index = 0; index < 1000; index += 1) {
      invalidateForwardDomainCacheForSlug(`aba-other-${index}`);
    }
    invalidateForwardDomainCacheForSlug('aba-forward');
    resolve?.('stale.example.com');
    await expect(pending).resolves.toBe('stale.example.com');
    mockEdgeGet.mockResolvedValueOnce('fresh.example.com');
    await expect(getCustomDomainForSlug('aba-forward')).resolves.toBe(
      'fresh.example.com'
    );
  });

  it('normalizes a successful forward mapping before caching it', async () => {
    mockEdgeGet.mockResolvedValue('  Store.Example.COM.  ');

    await expect(getCustomDomainForSlug('normalized-edge')).resolves.toBe(
      'store.example.com'
    );
    await expect(getCustomDomainForSlug('normalized-edge')).resolves.toBe(
      'store.example.com'
    );
    expect(mockEdgeGet).toHaveBeenCalledTimes(1);
  });

  it('falls back when Edge Config returns an invalid forward mapping', async () => {
    mockEdgeGet.mockResolvedValue('   ');
    mockMaybeSingle.mockResolvedValue({
      data: {
        id: 'merchant-1',
        domains: [
          {
            domain: 'db-fallback.example.com',
            is_primary: true,
            status: 'active',
            domain_type: 'custom',
          },
        ],
      },
    });

    await expect(getCustomDomainForSlug('invalid-edge')).resolves.toBe(
      'db-fallback.example.com'
    );
    expect(mockFrom).toHaveBeenCalled();
  });

  it('rejects URL-shaped forward mappings and does not cache them', async () => {
    mockEdgeGet
      .mockResolvedValueOnce('https://store.example.com/path')
      .mockResolvedValueOnce('valid.example.com');
    mockMaybeSingle.mockResolvedValue({ data: null });

    await expect(
      getCustomDomainForSlug('malformed-forward')
    ).resolves.toBeNull();
    await expect(getCustomDomainForSlug('malformed-forward')).resolves.toBe(
      'valid.example.com'
    );
    expect(mockEdgeGet).toHaveBeenCalledTimes(2);
  });

  it('shares only concurrent normalized reverse reads', async () => {
    let resolve: ((value: string) => void) | undefined;
    const providerRead = new Promise<string>((done) => {
      resolve = done;
    });
    mockEdgeGet.mockReturnValueOnce(providerRead);

    const first = getSlugForCustomDomain(' OGABASSEY.COM. ');
    const second = getSlugForCustomDomain('ogabassey.com');
    resolve?.('ogabassey');

    await expect(Promise.all([first, second])).resolves.toEqual([
      'ogabassey',
      'ogabassey',
    ]);
    expect(mockEdgeGet).toHaveBeenCalledTimes(1);
  });

  it('refreshes a positive reverse mapping after 60 seconds', async () => {
    mockEdgeGet
      .mockResolvedValueOnce('reverse-slug')
      .mockResolvedValueOnce('updated-slug');

    await expect(getSlugForCustomDomain('reverse-warm.com')).resolves.toBe(
      'reverse-slug'
    );
    await expect(getSlugForCustomDomain('reverse-warm.com')).resolves.toBe(
      'reverse-slug'
    );
    expect(mockEdgeGet).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(60_001);
    await expect(getSlugForCustomDomain('reverse-warm.com')).resolves.toBe(
      'updated-slug'
    );
    expect(mockEdgeGet).toHaveBeenCalledTimes(2);
  });

  it('does not cache a reverse result that resolves after invalidation', async () => {
    let resolve: ((value: string) => void) | undefined;
    mockEdgeGet.mockReturnValueOnce(new Promise<string>((r) => (resolve = r)));
    const pending = getSlugForCustomDomain('race-reverse.com');
    invalidateReverseDomainCacheForDomain('race-reverse.com');
    resolve?.('old-slug');
    await expect(pending).resolves.toBe('old-slug');
    mockEdgeGet.mockResolvedValueOnce('new-slug');
    await expect(getSlugForCustomDomain('race-reverse.com')).resolves.toBe(
      'new-slug'
    );
    expect(mockEdgeGet).toHaveBeenCalledTimes(2);
  });

  it('fences an uncached reverse read invalidated by slug', async () => {
    let resolve: ((value: string) => void) | undefined;
    let notifyProviderStarted: (() => void) | undefined;
    const providerStarted = new Promise<void>(
      (started) => (notifyProviderStarted = started)
    );
    mockEdgeGet.mockImplementationOnce(() => {
      notifyProviderStarted?.();
      return new Promise<string>((r) => (resolve = r));
    });
    const pending = getSlugForCustomDomain('race-slug.com');
    await providerStarted;
    invalidateReverseDomainCacheForSlug('old-slug');
    mockEdgeGet.mockResolvedValueOnce('new-slug');
    const fresh = getSlugForCustomDomain('race-slug.com');
    resolve?.('old-slug');
    await expect(pending).resolves.toBe('old-slug');
    await expect(fresh).resolves.toBe('new-slug');
    expect(mockEdgeGet).toHaveBeenCalledTimes(2);
  });

  it('keeps reverse slug fences safe after tombstone eviction', async () => {
    invalidateReverseDomainCacheForSlug('aba-reverse');
    let resolve: ((value: string) => void) | undefined;
    mockEdgeGet.mockReturnValueOnce(new Promise<string>((r) => (resolve = r)));
    const pending = getSlugForCustomDomain('aba-reverse.com');
    invalidateReverseDomainCacheForSlug('aba-reverse');
    for (let index = 0; index < 1000; index += 1) {
      invalidateReverseDomainCacheForSlug(`aba-reverse-${index}`);
    }
    resolve?.('aba-reverse');
    await expect(pending).resolves.toBe('aba-reverse');
    mockEdgeGet.mockResolvedValueOnce('fresh-reverse');
    await expect(getSlugForCustomDomain('aba-reverse.com')).resolves.toBe(
      'fresh-reverse'
    );
  });

  it('does not cache a pending null reverse DB result after slug invalidation', async () => {
    mockEdgeGet.mockRejectedValue(new Error('provider outage'));
    let resolveDb: ((value: { data: null }) => void) | undefined;
    let dbStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => (dbStarted = resolve));
    mockMaybeSingle.mockImplementationOnce(
      () =>
        new Promise<{ data: null }>((resolve) => {
          resolveDb = resolve;
          dbStarted?.();
        })
    );
    const pending = getSlugForCustomDomain('null-race-reverse.com');
    await started;
    invalidateReverseDomainCacheForSlug('missing-slug');
    resolveDb?.({ data: null });
    await expect(pending).resolves.toBeNull();
    await vi.advanceTimersByTimeAsync(0);
    mockMaybeSingle.mockResolvedValueOnce({ data: null });
    await expect(
      getSlugForCustomDomain('null-race-reverse.com')
    ).resolves.toBeNull();
    expect(mockEdgeGet).toHaveBeenCalledTimes(2);
    expect(mockFrom).toHaveBeenCalledTimes(2);
  });

  it('rejects malformed reverse slugs and does not cache them', async () => {
    mockEdgeGet
      .mockResolvedValueOnce('merchant/path')
      .mockResolvedValueOnce('merchant-slug');
    mockMaybeSingle.mockResolvedValue({ data: null });

    await expect(
      getSlugForCustomDomain('malformed-reverse.com')
    ).resolves.toBeNull();
    await expect(getSlugForCustomDomain('malformed-reverse.com')).resolves.toBe(
      'merchant-slug'
    );
    expect(mockEdgeGet).toHaveBeenCalledTimes(2);
  });

  it('retries after a provider failure without retaining it', async () => {
    mockEdgeGet
      .mockRejectedValueOnce(new Error('temporary outage'))
      .mockResolvedValueOnce('recovered-edge.com');
    mockMaybeSingle.mockResolvedValue({ data: null });

    await getCustomDomainForSlug('edge-retry');

    await expect(getCustomDomainForSlug('edge-retry')).resolves.toBe(
      'recovered-edge.com'
    );
    expect(mockEdgeGet).toHaveBeenCalledTimes(2);
  });

  it('coalesces DB fallback reads during a provider outage', async () => {
    let resolveDb:
      | ((value: { data: { id: string; domains: null } }) => void)
      | undefined;
    const dbRead = new Promise<{ data: { id: string; domains: null } }>(
      (resolve) => {
        resolveDb = resolve;
      }
    );
    mockEdgeGet.mockRejectedValue(new Error('provider outage'));
    mockMaybeSingle.mockReturnValue(dbRead);

    const first = getCustomDomainForSlug('fallback-stampede');
    const second = getCustomDomainForSlug(' FALLBACK-STAMPEDE ');
    resolveDb?.({ data: { id: 'merchant-1', domains: null } });

    await expect(Promise.all([first, second])).resolves.toEqual([null, null]);
    expect(mockEdgeGet).toHaveBeenCalledTimes(1);
    expect(mockFrom).toHaveBeenCalledTimes(1);
  });

  it('does not cache a forward DB result resolved after invalidation', async () => {
    mockEdgeGet.mockRejectedValue(new Error('provider outage'));
    let resolveDb: ((value: { data: unknown }) => void) | undefined;
    const dbRead = new Promise<{ data: unknown }>(
      (resolve) => (resolveDb = resolve)
    );
    let notifyDbStarted: (() => void) | undefined;
    const dbStarted = new Promise<void>(
      (resolve) => (notifyDbStarted = resolve)
    );
    mockMaybeSingle.mockImplementationOnce(() => {
      notifyDbStarted?.();
      return dbRead;
    });
    const pending = getCustomDomainForSlug('db-race-forward');
    await dbStarted;
    expect(mockFrom).toHaveBeenCalledOnce();
    invalidateForwardDomainCacheForSlug('db-race-forward');
    let notifyFreshDbStarted: (() => void) | undefined;
    const freshDbStarted = new Promise<void>(
      (resolve) => (notifyFreshDbStarted = resolve)
    );
    mockMaybeSingle.mockImplementationOnce(() => {
      notifyFreshDbStarted?.();
      return Promise.resolve({
        data: {
          id: 'm1',
          domains: [
            {
              domain: 'new.example.com',
              is_primary: true,
              status: 'active',
              domain_type: 'custom',
            },
          ],
        },
      });
    });
    const fresh = getCustomDomainForSlug('db-race-forward');
    await freshDbStarted;
    expect(mockFrom).toHaveBeenCalledTimes(2);
    resolveDb?.({ data: { id: 'm1', domains: null } });
    await expect(pending).resolves.toBeNull();
    await expect(fresh).resolves.toBe('new.example.com');
    expect(mockFrom).toHaveBeenCalledTimes(2);
  });

  it('does not cache a reverse DB result resolved after invalidation', async () => {
    mockEdgeGet.mockRejectedValue(new Error('provider outage'));
    let resolveDb: ((value: { data: unknown }) => void) | undefined;
    const dbRead = new Promise<{ data: unknown }>(
      (resolve) => (resolveDb = resolve)
    );
    let notifyDbStarted: (() => void) | undefined;
    const dbStarted = new Promise<void>(
      (resolve) => (notifyDbStarted = resolve)
    );
    mockMaybeSingle.mockImplementationOnce(() => {
      notifyDbStarted?.();
      return dbRead;
    });
    const pending = getSlugForCustomDomain('db-race-reverse.com');
    await dbStarted;
    expect(mockFrom).toHaveBeenCalledOnce();
    invalidateReverseDomainCacheForDomain('db-race-reverse.com');
    let notifyFreshDbStarted: (() => void) | undefined;
    const freshDbStarted = new Promise<void>(
      (resolve) => (notifyFreshDbStarted = resolve)
    );
    mockMaybeSingle.mockImplementationOnce(() => {
      notifyFreshDbStarted?.();
      return Promise.resolve({ data: { merchants: { slug: 'new-slug' } } });
    });
    const fresh = getSlugForCustomDomain('db-race-reverse.com');
    await freshDbStarted;
    expect(mockFrom).toHaveBeenCalledTimes(2);
    resolveDb?.({ data: { merchants: { slug: 'old-slug' } } });
    await expect(pending).resolves.toBe('old-slug');
    await expect(fresh).resolves.toBe('new-slug');
    expect(mockFrom).toHaveBeenCalledTimes(2);
  });

  it('prefers a new Edge mapping over a warm DB fallback', async () => {
    mockEdgeGet
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce('current-edge-slug');
    mockMaybeSingle.mockResolvedValue({
      data: { merchants: { slug: 'stale-db-slug' } },
    });

    await expect(getSlugForCustomDomain('promoted.com')).resolves.toBe(
      'stale-db-slug'
    );
    await expect(getSlugForCustomDomain('promoted.com')).resolves.toBe(
      'current-edge-slug'
    );
    expect(mockFrom).toHaveBeenCalledTimes(1);
  });
});
