import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockEdgeGet = vi.fn();
const mockFetchCustomDomain = vi.fn();
const mockFetchSlugForDomain = vi.fn();

vi.mock('@vercel/edge-config', () => ({
  get: (...args: unknown[]) => mockEdgeGet(...args),
}));
vi.mock('./domain-cache-database', () => ({
  fetchCustomDomain: (...args: unknown[]) => mockFetchCustomDomain(...args),
  fetchSlugForDomain: (...args: unknown[]) => mockFetchSlugForDomain(...args),
}));

const {
  getCustomDomainForSlug,
  getSlugForCustomDomain,
  invalidateForwardDomainCacheForSlug,
  invalidateReverseDomainCacheForDomain,
  invalidateReverseDomainCacheForSlug,
} = await import('./domain-cache-simple');

describe('domain cache read coalescing and invalidation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockEdgeGet.mockReset();
    mockFetchCustomDomain.mockReset();
    mockFetchSlugForDomain.mockReset();
    mockEdgeGet.mockRejectedValue(new Error('Edge Config unavailable'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shares concurrent normalized forward resolver reads', async () => {
    let resolve:
      | ((value: { outcome: 'resolved'; value: string }) => void)
      | undefined;
    mockFetchCustomDomain.mockReturnValueOnce(
      new Promise((done) => (resolve = done))
    );

    const first = getCustomDomainForSlug(' SHOP ');
    const second = getCustomDomainForSlug('shop');
    resolve?.({ outcome: 'resolved', value: 'shop.test' });

    await expect(Promise.all([first, second])).resolves.toEqual([
      'shop.test',
      'shop.test',
    ]);
    expect(mockFetchCustomDomain).toHaveBeenCalledTimes(1);
  });

  it('does not cache a forward result that finishes after invalidation', async () => {
    let resolve:
      | ((value: { outcome: 'resolved'; value: string }) => void)
      | undefined;
    let started: (() => void) | undefined;
    const readStarted = new Promise<void>((done) => (started = done));
    mockFetchCustomDomain.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
          started?.();
        })
    );
    const stale = getCustomDomainForSlug('forward-race');
    await readStarted;
    invalidateForwardDomainCacheForSlug('forward-race');
    resolve?.({ outcome: 'resolved', value: 'old.test' });
    await expect(stale).resolves.toBe('old.test');
    mockFetchCustomDomain.mockResolvedValueOnce({
      outcome: 'resolved',
      value: 'new.test',
    });

    await expect(getCustomDomainForSlug('forward-race')).resolves.toBe(
      'new.test'
    );
  });

  it('shares concurrent normalized reverse resolver reads', async () => {
    let resolve:
      | ((value: { outcome: 'resolved'; value: string }) => void)
      | undefined;
    mockFetchSlugForDomain.mockReturnValueOnce(
      new Promise((done) => (resolve = done))
    );

    const first = getSlugForCustomDomain(' SHOP.TEST. ');
    const second = getSlugForCustomDomain('shop.test');
    resolve?.({ outcome: 'resolved', value: 'shop' });

    await expect(Promise.all([first, second])).resolves.toEqual([
      'shop',
      'shop',
    ]);
    expect(mockFetchSlugForDomain).toHaveBeenCalledTimes(1);
  });

  it('does not cache a reverse result that finishes after invalidation', async () => {
    let resolve:
      | ((value: { outcome: 'resolved'; value: string }) => void)
      | undefined;
    let started: (() => void) | undefined;
    const readStarted = new Promise<void>((done) => (started = done));
    mockFetchSlugForDomain.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
          started?.();
        })
    );
    const stale = getSlugForCustomDomain('reverse-race.test');
    await readStarted;
    invalidateReverseDomainCacheForDomain('reverse-race.test');
    resolve?.({ outcome: 'resolved', value: 'old' });
    await expect(stale).resolves.toBe('old');
    mockFetchSlugForDomain.mockResolvedValueOnce({
      outcome: 'resolved',
      value: 'new',
    });

    await expect(getSlugForCustomDomain('reverse-race.test')).resolves.toBe(
      'new'
    );
  });

  it('refreshes a positive forward Edge Config mapping after its warm TTL', async () => {
    mockEdgeGet
      .mockResolvedValueOnce('edge-forward-old.test')
      .mockResolvedValueOnce('edge-forward-new.test');

    await expect(getCustomDomainForSlug('edge-forward-ttl')).resolves.toBe(
      'edge-forward-old.test'
    );
    await expect(getCustomDomainForSlug('edge-forward-ttl')).resolves.toBe(
      'edge-forward-old.test'
    );
    vi.advanceTimersByTime(60_001);
    await expect(getCustomDomainForSlug('edge-forward-ttl')).resolves.toBe(
      'edge-forward-new.test'
    );
    expect(mockEdgeGet).toHaveBeenCalledTimes(2);
  });

  it('normalizes a successful forward Edge Config mapping before warming it', async () => {
    mockEdgeGet.mockResolvedValue('  Store.Example.COM.  ');

    await expect(
      getCustomDomainForSlug('edge-forward-normalized')
    ).resolves.toBe('store.example.com');
    await expect(
      getCustomDomainForSlug('edge-forward-normalized')
    ).resolves.toBe('store.example.com');
    expect(mockEdgeGet).toHaveBeenCalledTimes(1);
  });

  it('refreshes a positive reverse Edge Config mapping after its warm TTL', async () => {
    mockEdgeGet
      .mockResolvedValueOnce('edge-reverse-old')
      .mockResolvedValueOnce('edge-reverse-new');

    await expect(getSlugForCustomDomain('edge-reverse-ttl.test')).resolves.toBe(
      'edge-reverse-old'
    );
    await expect(getSlugForCustomDomain('edge-reverse-ttl.test')).resolves.toBe(
      'edge-reverse-old'
    );
    vi.advanceTimersByTime(60_001);
    await expect(getSlugForCustomDomain('edge-reverse-ttl.test')).resolves.toBe(
      'edge-reverse-new'
    );
    expect(mockEdgeGet).toHaveBeenCalledTimes(2);
  });

  it('does not warm a malformed forward Edge Config value', async () => {
    mockEdgeGet
      .mockResolvedValueOnce('https://not-a-host.test/path')
      .mockResolvedValueOnce('valid-forward.test');
    mockFetchCustomDomain.mockResolvedValue({ outcome: 'not-found' });

    await expect(
      getCustomDomainForSlug('malformed-forward-edge')
    ).resolves.toBeNull();
    await expect(
      getCustomDomainForSlug('malformed-forward-edge')
    ).resolves.toBe('valid-forward.test');
    expect(mockEdgeGet).toHaveBeenCalledTimes(2);
  });

  it('does not warm a malformed reverse Edge Config value', async () => {
    mockEdgeGet
      .mockResolvedValueOnce('merchant/path')
      .mockResolvedValueOnce('valid-reverse');
    mockFetchSlugForDomain.mockResolvedValue({ outcome: 'not-found' });

    await expect(
      getSlugForCustomDomain('malformed-reverse-edge.test')
    ).resolves.toBeNull();
    await expect(
      getSlugForCustomDomain('malformed-reverse-edge.test')
    ).resolves.toBe('valid-reverse');
    expect(mockEdgeGet).toHaveBeenCalledTimes(2);
  });

  it('retries Edge Config after a failure instead of warming its fallback', async () => {
    mockEdgeGet
      .mockRejectedValueOnce(new Error('edge unavailable'))
      .mockResolvedValueOnce('recovered-edge.test');
    mockFetchCustomDomain.mockResolvedValue({ outcome: 'unavailable' });

    await expect(getCustomDomainForSlug('edge-retry')).resolves.toBeNull();
    await expect(getCustomDomainForSlug('edge-retry')).resolves.toBe(
      'recovered-edge.test'
    );
    expect(mockEdgeGet).toHaveBeenCalledTimes(2);
  });

  it('shares concurrent fallback reads while Edge Config is unavailable', async () => {
    let resolve:
      | ((value: { outcome: 'resolved'; value: string }) => void)
      | undefined;
    mockFetchCustomDomain.mockReturnValueOnce(
      new Promise((done) => (resolve = done))
    );

    const first = getCustomDomainForSlug('fallback-coalesce');
    const second = getCustomDomainForSlug('fallback-coalesce');
    resolve?.({ outcome: 'resolved', value: 'fallback-coalesce.test' });

    await expect(Promise.all([first, second])).resolves.toEqual([
      'fallback-coalesce.test',
      'fallback-coalesce.test',
    ]);
    expect(mockFetchCustomDomain).toHaveBeenCalledTimes(1);
  });

  it('lets a fresh Edge Config reverse mapping override a warm fallback', async () => {
    mockEdgeGet
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce('new-edge-slug');
    mockFetchSlugForDomain.mockResolvedValue({
      outcome: 'resolved',
      value: 'old-fallback-slug',
    });

    await expect(
      getSlugForCustomDomain('edge-wins-reverse.test')
    ).resolves.toBe('old-fallback-slug');
    await expect(
      getSlugForCustomDomain('edge-wins-reverse.test')
    ).resolves.toBe('new-edge-slug');
  });

  it('fences a pending reverse not-found after slug invalidation', async () => {
    let resolve: ((value: { outcome: 'not-found' }) => void) | undefined;
    let started: (() => void) | undefined;
    const readStarted = new Promise<void>((done) => (started = done));
    mockFetchSlugForDomain.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
          started?.();
        })
    );

    const stale = getSlugForCustomDomain('reverse-null-fence.test');
    await readStarted;
    invalidateReverseDomainCacheForSlug('missing-slug');
    resolve?.({ outcome: 'not-found' });
    await expect(stale).resolves.toBeNull();
    mockFetchSlugForDomain.mockResolvedValueOnce({ outcome: 'not-found' });

    await expect(
      getSlugForCustomDomain('reverse-null-fence.test')
    ).resolves.toBeNull();
    expect(mockFetchSlugForDomain).toHaveBeenCalledTimes(2);
  });

  it('fences an Edge reverse read invalidated by its returned slug', async () => {
    let resolve: ((value: string) => void) | undefined;
    let started: (() => void) | undefined;
    const readStarted = new Promise<void>((done) => (started = done));
    mockEdgeGet.mockImplementationOnce(() => {
      started?.();
      return new Promise((done) => (resolve = done));
    });

    const stale = getSlugForCustomDomain('reverse-slug-fence.test');
    await readStarted;
    invalidateReverseDomainCacheForSlug('old-slug');
    mockEdgeGet.mockResolvedValueOnce('new-slug');
    const fresh = getSlugForCustomDomain('reverse-slug-fence.test');
    resolve?.('old-slug');

    await expect(stale).resolves.toBe('old-slug');
    await expect(fresh).resolves.toBe('new-slug');
  });

  it('keeps forward generation fences after tombstone eviction', async () => {
    invalidateForwardDomainCacheForSlug('forward-aba');
    let resolve: ((value: string) => void) | undefined;
    mockEdgeGet.mockReturnValueOnce(new Promise((done) => (resolve = done)));
    const stale = getCustomDomainForSlug('forward-aba');
    invalidateForwardDomainCacheForSlug('forward-aba');
    for (let index = 0; index < 1000; index += 1) {
      invalidateForwardDomainCacheForSlug(`forward-aba-other-${index}`);
    }
    invalidateForwardDomainCacheForSlug('forward-aba');
    resolve?.('stale-aba.test');
    await expect(stale).resolves.toBe('stale-aba.test');
    mockEdgeGet.mockResolvedValueOnce('fresh-aba.test');

    await expect(getCustomDomainForSlug('forward-aba')).resolves.toBe(
      'fresh-aba.test'
    );
  });

  it('keeps reverse slug fences after tombstone eviction', async () => {
    invalidateReverseDomainCacheForSlug('reverse-aba');
    let resolve: ((value: string) => void) | undefined;
    mockEdgeGet.mockReturnValueOnce(new Promise((done) => (resolve = done)));
    const stale = getSlugForCustomDomain('reverse-aba.test');
    invalidateReverseDomainCacheForSlug('reverse-aba');
    for (let index = 0; index < 1000; index += 1) {
      invalidateReverseDomainCacheForSlug(`reverse-aba-other-${index}`);
    }
    resolve?.('reverse-aba');
    await expect(stale).resolves.toBe('reverse-aba');
    mockEdgeGet.mockResolvedValueOnce('fresh-reverse-aba');

    await expect(getSlugForCustomDomain('reverse-aba.test')).resolves.toBe(
      'fresh-reverse-aba'
    );
  });
});
