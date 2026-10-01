import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reloadMerchantBySlug } from './merchant-reload-by-slug';
import { fetchMerchantBySlug, fetchPrimaryDomain } from './queries';

vi.mock('./queries', () => ({
  fetchMerchantBySlug: vi.fn(),
  fetchPrimaryDomain: vi.fn(),
}));

describe('merchant-reload-by-slug', () => {
  const setMerchant = vi.fn();
  const setLoading = vi.fn();
  const supabase = {} as never;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reloads the merchant and settles loading', async () => {
    vi.mocked(fetchMerchantBySlug).mockResolvedValue({
      id: 'merchant-1',
      slug: 'acme',
    } as never);
    vi.mocked(fetchPrimaryDomain).mockResolvedValue('acme.com');
    const getSupabase = vi.fn(async () => supabase);

    await reloadMerchantBySlug({
      getSupabase,
      slug: 'acme',
      setMerchant,
      setLoading,
    });

    expect(setMerchant).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'merchant-1', custom_domain: 'acme.com' })
    );
    expect(setLoading).toHaveBeenCalledWith(false);
  });

  it('settles loading when the reload fetch fails', async () => {
    vi.mocked(fetchMerchantBySlug).mockRejectedValue(new Error('db down'));
    const getSupabase = vi.fn(async () => supabase);

    await reloadMerchantBySlug({
      getSupabase,
      slug: 'acme',
      setMerchant,
      setLoading,
    });

    expect(setMerchant).not.toHaveBeenCalled();
    expect(setLoading).toHaveBeenCalledWith(false);
  });

  it('settles loading when the lazy client fails to load', async () => {
    const getSupabase = vi.fn().mockRejectedValue(new Error('chunk failed'));

    await reloadMerchantBySlug({
      getSupabase,
      slug: 'acme',
      setMerchant,
      setLoading,
    });

    expect(fetchMerchantBySlug).not.toHaveBeenCalled();
    expect(setLoading).toHaveBeenCalledWith(false);
  });
});
