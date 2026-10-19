import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StorefrontSitemapContext } from './sitemap-data';

const { mockGetData, mockGetGraphicsOptions } = vi.hoisted(() => ({
  mockGetData: vi.fn(),
  mockGetGraphicsOptions: vi.fn(),
}));

vi.mock('@/lib/cached-data', () => ({
  getCachedCategoryPageData: (...args: unknown[]) => mockGetData(...args),
  getCachedCategoryPageGraphicsOptions: (...args: unknown[]) =>
    mockGetGraphicsOptions(...args),
}));

import { getGamingGraphicsHubSitemapEntries } from './gaming-graphics-hub-sitemap';

const context = {
  merchant: {
    id: 'merchant-1',
    is_published: true,
    slug: 'ogabassey',
  },
  storeUrl: 'https://ogabassey.com',
  supabase: {},
} as unknown as StorefrontSitemapContext;

describe('getGamingGraphicsHubSitemapEntries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetGraphicsOptions.mockResolvedValue([
      'NVIDIA RTX 4060',
      '8GB RTX 4070 Graphics',
    ]);
    mockGetData.mockImplementation(async (...args: unknown[]) => ({
      productCount: (args[5] as { graphics: string[] }).graphics[0]?.includes(
        '4070'
      )
        ? 12
        : 1,
      products: [{ id: 'product-1' }],
      productsQueryFailed: false,
    }));
  });

  it('lists only inventory-qualified curated graphics hubs', async () => {
    await expect(getGamingGraphicsHubSitemapEntries(context)).resolves.toEqual([
      {
        url: 'https://ogabassey.com/gaming-laptops/graphics/rtx-4070',
        changeFrequency: 'daily',
        priority: 0.65,
      },
    ]);
  });

  it('fails open when optional hub discovery is unavailable', async () => {
    mockGetGraphicsOptions.mockRejectedValueOnce(new Error('timeout'));

    await expect(getGamingGraphicsHubSitemapEntries(context)).resolves.toEqual(
      []
    );
  });
});
