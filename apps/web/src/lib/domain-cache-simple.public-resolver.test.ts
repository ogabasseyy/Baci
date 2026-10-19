import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockEdgeGet = vi.fn();
const mockCreateAdminClient = vi.fn();
const mockFetchCustomDomain = vi.fn();
const mockFetchSlugForDomain = vi.fn();

vi.mock('@vercel/edge-config', () => ({
  get: (...args: unknown[]) => mockEdgeGet(...args),
}));
vi.mock('./supabase/admin', () => ({
  createAdminClient: () => mockCreateAdminClient(),
}));
vi.mock('./domain-cache-database', () => ({
  fetchCustomDomain: (...args: unknown[]) => mockFetchCustomDomain(...args),
  fetchSlugForDomain: (...args: unknown[]) => mockFetchSlugForDomain(...args),
}));

const { getCustomDomainForSlug, getSlugForCustomDomain } = await import(
  './domain-cache-simple'
);

describe('domain cache public resolver fallback', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockEdgeGet.mockReset();
    mockCreateAdminClient.mockReset();
    mockFetchCustomDomain.mockReset();
    mockFetchSlugForDomain.mockReset();
    mockEdgeGet.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses only the public resolver after an Edge Config forward miss', async () => {
    mockFetchCustomDomain.mockResolvedValue({
      outcome: 'resolved',
      value: 'shop.example.com',
    });

    await expect(getCustomDomainForSlug('shop')).resolves.toBe(
      'shop.example.com'
    );
    expect(mockFetchCustomDomain).toHaveBeenCalledWith('shop');
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
  });

  it('does not poison a reverse negative cache after an unavailable resolver', async () => {
    mockFetchSlugForDomain
      .mockResolvedValueOnce({ outcome: 'unavailable' })
      .mockResolvedValueOnce({ outcome: 'resolved', value: 'shop' });

    await expect(
      getSlugForCustomDomain('shop.example.com')
    ).resolves.toBeNull();
    await expect(getSlugForCustomDomain('shop.example.com')).resolves.toBe(
      'shop'
    );
    expect(mockFetchSlugForDomain).toHaveBeenCalledTimes(2);
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
  });
});
