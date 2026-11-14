import { describe, expect, it, vi } from 'vitest';
import { getCommercialSupportCategorySitemapEntries } from './get-commercial-support-category-sitemap-entries';

describe('getCommercialSupportCategorySitemapEntries', () => {
  it('maps each usable merchant category into a commercial support sitemap entry', async () => {
    const eqActive = vi.fn(async () => ({
      data: [
        { slug: 'laptops', updated_at: '2026-08-02T12:00:00.000Z' },
        { slug: ' ', updated_at: '2026-08-03T12:00:00.000Z' },
        { slug: '../escape', updated_at: '2026-08-04T12:00:00.000Z' },
      ],
      error: null,
    }));
    const eqMerchant = vi.fn(() => ({ eq: eqActive }));
    const select = vi.fn(() => ({ eq: eqMerchant }));

    await expect(
      getCommercialSupportCategorySitemapEntries({
        merchantId: 'merchant-1',
        storeUrl: 'https://zorvexa.usebaci.com',
        supabase: { from: vi.fn(() => ({ select })) } as never,
      })
    ).resolves.toEqual([
      {
        categorySlug: 'laptops',
        changeFrequency: 'daily',
        lastModified: new Date('2026-08-02T12:00:00.000Z'),
        priority: 0.7,
        url: 'https://zorvexa.usebaci.com/laptops',
      },
    ]);
    expect(select).toHaveBeenCalledWith('slug, updated_at');
    expect(eqMerchant).toHaveBeenCalledWith('merchant_id', 'merchant-1');
    expect(eqActive).toHaveBeenCalledWith('is_active', true);
  });
});
