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
} = await import('./domain-cache-simple');

describe('domain cache fallback', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockEdgeGet.mockReset();
    mockFetchCustomDomain.mockReset();
    mockFetchSlugForDomain.mockReset();
    mockEdgeGet.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps an Edge Config forward mapping authoritative', async () => {
    mockEdgeGet.mockResolvedValue('shop.example.com');

    await expect(getCustomDomainForSlug('shop')).resolves.toBe(
      'shop.example.com'
    );
    expect(mockFetchCustomDomain).not.toHaveBeenCalled();
  });

  it('uses a public forward resolver result after an Edge Config miss', async () => {
    mockFetchCustomDomain.mockResolvedValue({
      outcome: 'resolved',
      value: 'shop.example.com',
    });

    await expect(getCustomDomainForSlug('public-forward')).resolves.toBe(
      'shop.example.com'
    );
    expect(mockFetchCustomDomain).toHaveBeenCalledWith('public-forward');
  });

  it('retains an authoritative forward miss for five minutes', async () => {
    mockFetchCustomDomain.mockResolvedValue({ outcome: 'not-found' });

    await expect(getCustomDomainForSlug('forward-miss')).resolves.toBeNull();
    vi.advanceTimersByTime(299_999);
    await expect(getCustomDomainForSlug('forward-miss')).resolves.toBeNull();
    expect(mockFetchCustomDomain).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2);
    await getCustomDomainForSlug('forward-miss');
    expect(mockFetchCustomDomain).toHaveBeenCalledTimes(2);
  });

  it('retries an unavailable forward resolver instead of caching a miss', async () => {
    mockFetchCustomDomain
      .mockResolvedValueOnce({ outcome: 'unavailable' })
      .mockResolvedValueOnce({ outcome: 'resolved', value: 'recovered.test' });

    await expect(getCustomDomainForSlug('forward-retry')).resolves.toBeNull();
    await expect(getCustomDomainForSlug('forward-retry')).resolves.toBe(
      'recovered.test'
    );
    expect(mockFetchCustomDomain).toHaveBeenCalledTimes(2);
  });

  it('drops a cached forward mapping on invalidation', async () => {
    mockFetchCustomDomain.mockResolvedValue({
      outcome: 'resolved',
      value: 'before.test',
    });
    await getCustomDomainForSlug('forward-invalidate');
    invalidateForwardDomainCacheForSlug('forward-invalidate');
    mockFetchCustomDomain.mockResolvedValue({
      outcome: 'resolved',
      value: 'after.test',
    });

    await expect(getCustomDomainForSlug('forward-invalidate')).resolves.toBe(
      'after.test'
    );
    expect(mockFetchCustomDomain).toHaveBeenCalledTimes(2);
  });

  it('retains a positive forward resolver mapping for five minutes', async () => {
    mockFetchCustomDomain.mockResolvedValue({
      outcome: 'resolved',
      value: 'forward-positive.test',
    });

    await getCustomDomainForSlug('forward-positive');
    vi.advanceTimersByTime(299_999);
    await expect(getCustomDomainForSlug('forward-positive')).resolves.toBe(
      'forward-positive.test'
    );
    expect(mockFetchCustomDomain).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2);
    mockFetchCustomDomain.mockResolvedValue({
      outcome: 'resolved',
      value: 'forward-refreshed.test',
    });
    await expect(getCustomDomainForSlug('forward-positive')).resolves.toBe(
      'forward-refreshed.test'
    );
    expect(mockFetchCustomDomain).toHaveBeenCalledTimes(2);
  });

  it('uses a public reverse resolver result after an Edge Config miss', async () => {
    mockFetchSlugForDomain.mockResolvedValue({
      outcome: 'resolved',
      value: 'shop',
    });

    await expect(getSlugForCustomDomain('shop.example.com')).resolves.toBe(
      'shop'
    );
    expect(mockFetchSlugForDomain).toHaveBeenCalledWith('shop.example.com');
  });

  it('retains an authoritative reverse miss for five minutes', async () => {
    mockFetchSlugForDomain.mockResolvedValue({ outcome: 'not-found' });

    await expect(
      getSlugForCustomDomain('reverse-miss.test')
    ).resolves.toBeNull();
    vi.advanceTimersByTime(299_999);
    await getSlugForCustomDomain('reverse-miss.test');
    expect(mockFetchSlugForDomain).toHaveBeenCalledTimes(1);
  });

  it('retries an unavailable reverse resolver instead of caching a miss', async () => {
    mockFetchSlugForDomain
      .mockResolvedValueOnce({ outcome: 'unavailable' })
      .mockResolvedValueOnce({ outcome: 'resolved', value: 'recovered' });

    await expect(
      getSlugForCustomDomain('reverse-retry.test')
    ).resolves.toBeNull();
    await expect(getSlugForCustomDomain('reverse-retry.test')).resolves.toBe(
      'recovered'
    );
    expect(mockFetchSlugForDomain).toHaveBeenCalledTimes(2);
  });

  it('drops a cached reverse mapping on invalidation', async () => {
    mockFetchSlugForDomain.mockResolvedValue({
      outcome: 'resolved',
      value: 'before',
    });
    await getSlugForCustomDomain('reverse-invalidate.test');
    invalidateReverseDomainCacheForDomain('reverse-invalidate.test');
    mockFetchSlugForDomain.mockResolvedValue({
      outcome: 'resolved',
      value: 'after',
    });

    await expect(
      getSlugForCustomDomain('reverse-invalidate.test')
    ).resolves.toBe('after');
    expect(mockFetchSlugForDomain).toHaveBeenCalledTimes(2);
  });

  it('retains a positive reverse resolver mapping for five minutes', async () => {
    mockFetchSlugForDomain.mockResolvedValue({
      outcome: 'resolved',
      value: 'reverse-positive',
    });

    await getSlugForCustomDomain('reverse-positive.test');
    vi.advanceTimersByTime(299_999);
    await expect(getSlugForCustomDomain('reverse-positive.test')).resolves.toBe(
      'reverse-positive'
    );
    expect(mockFetchSlugForDomain).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2);
    mockFetchSlugForDomain.mockResolvedValue({
      outcome: 'resolved',
      value: 'reverse-refreshed',
    });
    await expect(getSlugForCustomDomain('reverse-positive.test')).resolves.toBe(
      'reverse-refreshed'
    );
    expect(mockFetchSlugForDomain).toHaveBeenCalledTimes(2);
  });

  it('evicts the oldest reverse cache entry at capacity', async () => {
    mockFetchSlugForDomain.mockResolvedValue({
      outcome: 'resolved',
      value: 'cache-slug',
    });
    for (let index = 0; index < 1001; index += 1) {
      await getSlugForCustomDomain(`capacity-${index}.test`);
    }
    mockFetchSlugForDomain.mockClear();

    await getSlugForCustomDomain('capacity-0.test');
    expect(mockFetchSlugForDomain).toHaveBeenCalledTimes(1);
  });
});
