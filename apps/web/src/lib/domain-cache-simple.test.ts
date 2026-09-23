import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock Edge Config
const mockEdgeGet = vi.fn();
vi.mock('@vercel/edge-config', () => ({
  get: (...args: unknown[]) => mockEdgeGet(...args),
}));

// Mock Supabase admin client (DB fallback)
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
} = await import('./domain-cache-simple');

beforeEach(() => {
  vi.useFakeTimers();
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

describe('getCustomDomainForSlug', () => {
  describe('Edge Config path', () => {
    it('returns domain from Edge Config without hitting DB', async () => {
      mockEdgeGet.mockResolvedValue('ogabassey.com');

      const result = await getCustomDomainForSlug('ogabassey');

      expect(result).toBe('ogabassey.com');
      expect(mockEdgeGet).toHaveBeenCalledWith('slug_ogabassey');
      expect(mockFrom).not.toHaveBeenCalled();
    });

    it('falls back to DB when Edge Config key is missing', async () => {
      mockEdgeGet.mockResolvedValue(undefined);
      mockMaybeSingle.mockResolvedValue({
        data: {
          id: '123',
          domains: [
            {
              domain: 'fallback-from-db.com',
              is_primary: true,
              status: 'active',
              domain_type: 'custom',
            },
          ],
        },
      });

      const result = await getCustomDomainForSlug('unknown');

      expect(result).toBe('fallback-from-db.com');
      expect(mockFrom).toHaveBeenCalled();
    });
  });

  describe('DB fallback path', () => {
    beforeEach(() => {
      // Simulate Edge Config unavailable
      mockEdgeGet.mockRejectedValue(new Error('EDGE_CONFIG not set'));
    });

    it('falls back to DB when Edge Config is unavailable', async () => {
      mockMaybeSingle.mockResolvedValue({
        data: {
          id: '123',
          domains: [
            {
              domain: 'fallback.com',
              is_primary: true,
              status: 'active',
              domain_type: 'custom',
            },
          ],
        },
      });

      const result = await getCustomDomainForSlug('fallback-merchant');
      expect(result).toBe('fallback.com');
    });

    it('returns null when merchant has no domains', async () => {
      mockMaybeSingle.mockResolvedValue({
        data: { id: '123', domains: null },
      });

      const result = await getCustomDomainForSlug('nodomains');
      expect(result).toBeNull();
    });

    it('returns null when multiple active domains exist and none is primary', async () => {
      mockMaybeSingle.mockResolvedValue({
        data: {
          id: '123',
          domains: [
            {
              domain: 'example.com',
              is_primary: false,
              status: 'active',
              domain_type: 'custom',
            },
            {
              domain: 'another.com',
              is_primary: false,
              status: 'active',
              domain_type: 'purchased',
            },
            {
              domain: 'pending.com',
              is_primary: true,
              status: 'pending',
              domain_type: 'custom',
            },
          ],
        },
      });

      const result = await getCustomDomainForSlug('noprimary');
      expect(result).toBeNull();
    });

    it('returns single active custom domain when no primary exists', async () => {
      mockMaybeSingle.mockResolvedValue({
        data: {
          id: '123',
          domains: [
            {
              domain: 'single-active.com',
              is_primary: false,
              status: 'active',
              domain_type: 'custom',
            },
            {
              domain: 'pending.com',
              is_primary: false,
              status: 'pending',
              domain_type: 'custom',
            },
          ],
        },
      });

      const result = await getCustomDomainForSlug('singleactive');
      expect(result).toBe('single-active.com');
    });

    it('returns null when merchant does not exist', async () => {
      mockMaybeSingle.mockResolvedValue({ data: null });

      const result = await getCustomDomainForSlug('nonexistent');
      expect(result).toBeNull();
    });

    it('retains the existing negative DB fallback result for five minutes', async () => {
      mockMaybeSingle.mockResolvedValue({ data: null });

      await expect(
        getCustomDomainForSlug('negative-not-cached')
      ).resolves.toBeNull();
      const firstReadCount = mockFrom.mock.calls.length;
      vi.advanceTimersByTime(299_999);
      await expect(
        getCustomDomainForSlug('negative-not-cached')
      ).resolves.toBeNull();

      expect(mockFrom.mock.calls.length).toBe(firstReadCount);
      vi.advanceTimersByTime(2);
      await expect(
        getCustomDomainForSlug('negative-not-cached')
      ).resolves.toBeNull();
      expect(mockFrom.mock.calls.length).toBeGreaterThan(firstReadCount);
    });

    it('returns null on database error', async () => {
      mockMaybeSingle.mockRejectedValue(new Error('DB connection failed'));

      const result = await getCustomDomainForSlug('error-slug');
      expect(result).toBeNull();
    });

    it('returns null when Supabase returns an error response', async () => {
      mockMaybeSingle.mockResolvedValue({
        data: null,
        error: {
          message: 'permission denied',
          code: '42501',
        },
      });

      const result = await getCustomDomainForSlug('permission-denied');
      expect(result).toBeNull();
    });

    it('caches DB results within TTL', async () => {
      mockMaybeSingle.mockResolvedValue({
        data: {
          id: '123',
          domains: [
            {
              domain: 'cached.com',
              is_primary: true,
              status: 'active',
              domain_type: 'custom',
            },
          ],
        },
      });

      await getCustomDomainForSlug('cached-merchant');
      const callCount = mockFrom.mock.calls.length;

      // Second call should use cache
      const second = await getCustomDomainForSlug('cached-merchant');
      expect(second).toBe('cached.com');
      expect(mockFrom).toHaveBeenCalledTimes(callCount);
    });

    it('re-queries the DB after invalidateForwardDomainCacheForSlug', async () => {
      mockMaybeSingle.mockResolvedValue({
        data: {
          id: '123',
          domains: [
            {
              domain: 'inv.com',
              is_primary: true,
              status: 'active',
              domain_type: 'custom',
            },
          ],
        },
      });

      await getCustomDomainForSlug('invalidate-me');
      const callCount = mockFrom.mock.calls.length;

      // On rename, the forward cache entry (a positive OR negative result) must be
      // dropped so the next lookup re-reads the DB instead of serving stale.
      invalidateForwardDomainCacheForSlug('invalidate-me');

      await getCustomDomainForSlug('invalidate-me');
      expect(mockFrom.mock.calls.length).toBeGreaterThan(callCount);
    });

    it('refreshes cache after TTL expires', async () => {
      mockMaybeSingle.mockResolvedValue({
        data: {
          id: '123',
          domains: [
            {
              domain: 'old.com',
              is_primary: true,
              status: 'active',
              domain_type: 'custom',
            },
          ],
        },
      });

      const first = await getCustomDomainForSlug('ttl-merchant');
      expect(first).toBe('old.com');

      vi.advanceTimersByTime(300_001);

      mockMaybeSingle.mockResolvedValue({
        data: {
          id: '123',
          domains: [
            {
              domain: 'new.com',
              is_primary: true,
              status: 'active',
              domain_type: 'custom',
            },
          ],
        },
      });

      const second = await getCustomDomainForSlug('ttl-merchant');
      expect(second).toBe('new.com');
    });
  });
});

describe('getSlugForCustomDomain', () => {
  it('returns slug from Edge Config without hitting DB', async () => {
    mockEdgeGet.mockResolvedValue('edge-slug');

    const result = await getSlugForCustomDomain('edge-domain.com');

    expect(result).toBe('edge-slug');
    expect(mockEdgeGet).toHaveBeenCalledWith('domain_edge-domain_com');
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('falls back to DB when Edge Config reverse key is missing', async () => {
    mockEdgeGet.mockResolvedValue(undefined);
    mockMaybeSingle.mockResolvedValue({
      data: {
        merchants: {
          slug: 'db-slug-after-edge-miss',
        },
      },
    });

    const result = await getSlugForCustomDomain('edge-miss-domain.com');

    expect(result).toBe('db-slug-after-edge-miss');
    expect(mockEdgeGet).toHaveBeenCalledWith('domain_edge-miss-domain_com');
    expect(mockFrom).toHaveBeenCalledWith('domains');
  });

  it('falls back to DB on cache miss', async () => {
    mockMaybeSingle.mockResolvedValue({
      data: {
        merchants: {
          slug: 'db-slug',
        },
      },
    });

    const result = await getSlugForCustomDomain('db-domain.com');
    expect(result).toBe('db-slug');
    expect(mockFrom).toHaveBeenCalledWith('domains');
    expect(mockSelect).toHaveBeenCalledWith('merchants!inner(slug)');
    expect(mockEq).toHaveBeenCalledWith('domain', 'db-domain.com');
    expect(mockEq).toHaveBeenCalledWith('status', 'active');
    expect(mockLimit).toHaveBeenCalledWith(1);
  });

  it('returns null when domain does not exist in DB', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null });

    const result = await getSlugForCustomDomain('nonexistent.com');
    expect(result).toBeNull();
  });

  it('returns null on database error', async () => {
    mockMaybeSingle.mockRejectedValue(new Error('DB failure'));

    const result = await getSlugForCustomDomain('error.com');
    expect(result).toBeNull();
  });

  it('returns null when Supabase returns an error response', async () => {
    mockMaybeSingle.mockResolvedValue({
      data: null,
      error: {
        message: 'invalid permissions',
        code: '42501',
      },
    });

    const result = await getSlugForCustomDomain('no-permission.com');
    expect(result).toBeNull();
  });

  it('caches DB results within TTL', async () => {
    mockMaybeSingle.mockResolvedValue({
      data: {
        merchants: {
          slug: 'cached-slug',
        },
      },
    });

    await getSlugForCustomDomain('cached-domain.com');
    const callCount = mockFrom.mock.calls.length;

    const second = await getSlugForCustomDomain('cached-domain.com');
    expect(second).toBe('cached-slug');
    expect(mockFrom).toHaveBeenCalledTimes(callCount);
  });

  it('refreshes cache after TTL expires', async () => {
    mockMaybeSingle.mockResolvedValue({
      data: {
        merchants: {
          slug: 'old-slug',
        },
      },
    });

    const first = await getSlugForCustomDomain('ttl-domain.com');
    expect(first).toBe('old-slug');

    vi.advanceTimersByTime(300_001);

    mockMaybeSingle.mockResolvedValue({
      data: {
        merchants: {
          slug: 'new-slug',
        },
      },
    });

    const second = await getSlugForCustomDomain('ttl-domain.com');
    expect(second).toBe('new-slug');
  });

  it('evicts oldest entry when cache size exceeds limit', async () => {
    mockMaybeSingle.mockImplementation(() => {
      return Promise.resolve({
        data: {
          merchants: {
            slug: 'evicted-slug',
          },
        },
      });
    });

    // Populate cache up to MAX_CACHE_SIZE (1000)
    for (let i = 0; i < 1000; i++) {
      await getSlugForCustomDomain(`domain_${i}.com`);
    }

    // Reset mock tracking
    mockFrom.mockClear();

    // Second call for domain_0 should be a cache hit (no DB query)
    const cached = await getSlugForCustomDomain('domain_0.com');
    expect(cached).toBe('evicted-slug');
    expect(mockFrom).not.toHaveBeenCalled();

    // Trigger eviction by adding domain_1000.com
    await getSlugForCustomDomain('domain_1000.com');

    // Reset mock tracking again
    mockFrom.mockClear();

    // Now domain_0 should be evicted and trigger a new DB read
    await getSlugForCustomDomain('domain_0.com');
    expect(mockFrom).toHaveBeenCalledWith('domains');
  });
});
