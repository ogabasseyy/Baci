import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  loadMerchantBySlug,
  reloadMerchantBySlug,
} from './merchant-slug-loader';
import { fetchMerchantBySlug, fetchPrimaryDomain } from './queries';

vi.mock('./queries', () => ({
  fetchMerchantBySlug: vi.fn(),
  fetchPrimaryDomain: vi.fn(),
}));

describe('merchant-slug-loader', () => {
  const setMerchant = vi.fn();
  const setLoading = vi.fn();
  const supabase = {} as never;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads the merchant and merges the primary domain', async () => {
    vi.mocked(fetchMerchantBySlug).mockResolvedValue({
      id: 'merchant-1',
      slug: 'acme',
    } as never);
    vi.mocked(fetchPrimaryDomain).mockResolvedValue('acme.com');

    await loadMerchantBySlug({
      supabase,
      slug: 'acme',
      isCancelled: () => false,
      setMerchant,
      setLoading,
    });

    expect(setMerchant).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'merchant-1', custom_domain: 'acme.com' })
    );
    expect(setLoading).toHaveBeenCalledWith(false);
  });

  it('clears the merchant and settles loading when the fetch fails', async () => {
    vi.mocked(fetchMerchantBySlug).mockRejectedValue(new Error('db down'));

    await loadMerchantBySlug({
      supabase,
      slug: 'acme',
      isCancelled: () => false,
      setMerchant,
      setLoading,
    });

    expect(setMerchant).toHaveBeenCalledWith(null);
    expect(setLoading).toHaveBeenCalledWith(false);
  });

  it('applies nothing after cancellation', async () => {
    vi.mocked(fetchMerchantBySlug).mockResolvedValue({
      id: 'merchant-1',
    } as never);

    await loadMerchantBySlug({
      supabase,
      slug: 'acme',
      isCancelled: () => true,
      setMerchant,
      setLoading,
    });

    expect(setMerchant).not.toHaveBeenCalled();
    expect(setLoading).not.toHaveBeenCalled();
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
