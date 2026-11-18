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

describe('domain cache Edge Config negative caching', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockEdgeGet.mockReset();
    mockFetchCustomDomain.mockReset();
    mockFetchSlugForDomain.mockReset();
    mockEdgeGet.mockResolvedValue(undefined);
    mockFetchCustomDomain.mockResolvedValue({ outcome: 'not-found' });
    mockFetchSlugForDomain.mockResolvedValue({ outcome: 'not-found' });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('caches forward Edge Config misses for 60s without re-querying Edge Config', async () => {
    mockEdgeGet
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce('recovered-forward.test');

    await expect(getCustomDomainForSlug('neg-forward')).resolves.toBeNull();
    vi.advanceTimersByTime(59_999);
    await expect(getCustomDomainForSlug('neg-forward')).resolves.toBeNull();
    expect(mockEdgeGet).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(2);
    await expect(getCustomDomainForSlug('neg-forward')).resolves.toBe(
      'recovered-forward.test'
    );
    expect(mockEdgeGet).toHaveBeenCalledTimes(2);
  });

  it('caches reverse Edge Config misses for 60s and still overrides a 5m fallback after expiry', async () => {
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
    vi.advanceTimersByTime(59_999);
    await expect(
      getSlugForCustomDomain('edge-wins-reverse.test')
    ).resolves.toBe('old-fallback-slug');
    expect(mockEdgeGet).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(2);
    await expect(
      getSlugForCustomDomain('edge-wins-reverse.test')
    ).resolves.toBe('new-edge-slug');
    expect(mockEdgeGet).toHaveBeenCalledTimes(2);
  });

  it('negative-caches malformed or non-string forward and reverse Edge Config values for 60s', async () => {
    mockEdgeGet
      .mockResolvedValueOnce('https://not-a-host.test/path')
      .mockResolvedValueOnce('merchant/path')
      .mockResolvedValueOnce('valid-forward.test')
      .mockResolvedValueOnce('valid-reverse');

    await expect(
      getCustomDomainForSlug('malformed-forward-edge')
    ).resolves.toBeNull();
    await expect(
      getCustomDomainForSlug('malformed-forward-edge')
    ).resolves.toBeNull();
    expect(mockEdgeGet).toHaveBeenCalledTimes(1);

    await expect(
      getSlugForCustomDomain('malformed-reverse-edge.test')
    ).resolves.toBeNull();
    await expect(
      getSlugForCustomDomain('malformed-reverse-edge.test')
    ).resolves.toBeNull();
    expect(mockEdgeGet).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(60_001);
    await expect(
      getCustomDomainForSlug('malformed-forward-edge')
    ).resolves.toBe('valid-forward.test');
    await expect(
      getSlugForCustomDomain('malformed-reverse-edge.test')
    ).resolves.toBe('valid-reverse');
    expect(mockEdgeGet).toHaveBeenCalledTimes(4);
  });

  it('never negative-caches thrown Edge Config errors for forward or reverse reads', async () => {
    mockEdgeGet
      .mockRejectedValueOnce(new Error('edge error'))
      .mockResolvedValueOnce('forward-after-error.test')
      .mockRejectedValueOnce(new Error('edge error'))
      .mockResolvedValueOnce('reverse-after-error');

    await expect(
      getCustomDomainForSlug('edge-throw-forward')
    ).resolves.toBeNull();
    await expect(getCustomDomainForSlug('edge-throw-forward')).resolves.toBe(
      'forward-after-error.test'
    );

    await expect(
      getSlugForCustomDomain('edge-throw-reverse.test')
    ).resolves.toBeNull();
    await expect(
      getSlugForCustomDomain('edge-throw-reverse.test')
    ).resolves.toBe('reverse-after-error');
    expect(mockEdgeGet).toHaveBeenCalledTimes(4);
  });

  it('clears negative Edge Config entries on forward, domain-reverse, and slug-reverse invalidations', async () => {
    mockEdgeGet
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce('now-mapped-forward.test')
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce('now-mapped-domain')
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce('now-mapped-slug');

    await expect(getCustomDomainForSlug('inv-neg-fwd')).resolves.toBeNull();
    invalidateForwardDomainCacheForSlug('inv-neg-fwd');
    await expect(getCustomDomainForSlug('inv-neg-fwd')).resolves.toBe(
      'now-mapped-forward.test'
    );

    await expect(
      getSlugForCustomDomain('inv-neg-dom.test')
    ).resolves.toBeNull();
    invalidateReverseDomainCacheForDomain('inv-neg-dom.test');
    await expect(getSlugForCustomDomain('inv-neg-dom.test')).resolves.toBe(
      'now-mapped-domain'
    );

    await expect(
      getSlugForCustomDomain('inv-neg-slug.test')
    ).resolves.toBeNull();
    invalidateReverseDomainCacheForSlug('now-mapped-slug');
    await expect(getSlugForCustomDomain('inv-neg-slug.test')).resolves.toBe(
      'now-mapped-slug'
    );

    expect(mockEdgeGet).toHaveBeenCalledTimes(6);
  });

  it('fences in-flight Edge Config misses when invalidated mid-flight', async () => {
    let resolveForward: ((value: undefined) => void) | undefined;
    let forwardStartedNotify: (() => void) | undefined;
    const forwardStarted = new Promise<void>(
      (done) => (forwardStartedNotify = done)
    );
    let resolveReverse: ((value: undefined) => void) | undefined;
    let reverseStartedNotify: (() => void) | undefined;
    const reverseStarted = new Promise<void>(
      (done) => (reverseStartedNotify = done)
    );

    mockEdgeGet
      .mockImplementationOnce(() => {
        forwardStartedNotify?.();
        return new Promise((done) => (resolveForward = done));
      })
      .mockResolvedValueOnce('fresh-after-fence.test')
      .mockImplementationOnce(() => {
        reverseStartedNotify?.();
        return new Promise((done) => (resolveReverse = done));
      })
      .mockResolvedValueOnce('fresh-slug-after-fence');

    const pendingForward = getCustomDomainForSlug('fence-neg-fwd');
    await forwardStarted;
    invalidateForwardDomainCacheForSlug('fence-neg-fwd');
    resolveForward?.(undefined);
    await expect(pendingForward).resolves.toBeNull();
    await expect(getCustomDomainForSlug('fence-neg-fwd')).resolves.toBe(
      'fresh-after-fence.test'
    );

    const pendingReverse = getSlugForCustomDomain('fence-neg-rev.test');
    await reverseStarted;
    invalidateReverseDomainCacheForDomain('fence-neg-rev.test');
    resolveReverse?.(undefined);
    await expect(pendingReverse).resolves.toBeNull();
    await expect(getSlugForCustomDomain('fence-neg-rev.test')).resolves.toBe(
      'fresh-slug-after-fence'
    );
  });

  it('evicts the oldest negative Edge Config entry at MAX_CACHE_SIZE without evicting positives', async () => {
    mockEdgeGet.mockResolvedValueOnce('pinned-positive.test');
    await expect(getCustomDomainForSlug('pinned-positive')).resolves.toBe(
      'pinned-positive.test'
    );

    for (let index = 0; index < 1001; index += 1) {
      await getCustomDomainForSlug(`neg-cap-${index}`);
    }
    mockEdgeGet.mockClear();

    await expect(getCustomDomainForSlug('pinned-positive')).resolves.toBe(
      'pinned-positive.test'
    );
    expect(mockEdgeGet).not.toHaveBeenCalled();

    await getCustomDomainForSlug('neg-cap-0');
    expect(mockEdgeGet).toHaveBeenCalledTimes(1);
  });
});
