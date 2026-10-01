import type { MetadataRoute } from 'next';
import {
  buildGamingLaptopGraphicsHubPath,
  GAMING_LAPTOPS_CATEGORY_SLUG,
} from '@/lib/storefront-category/gaming-laptop-graphics-hubs';
import { loadPublishedGamingLaptopGraphicsHubs } from '@/lib/storefront-category/load-published-gaming-laptop-graphics-hubs';
import { isStorefrontSitemapPublished } from '@/lib/storefront-seo/is-storefront-sitemap-published';
import type { StorefrontSitemapContext } from './sitemap-data';

export async function getGamingGraphicsHubSitemapEntries({
  merchant,
  storeUrl,
}: StorefrontSitemapContext): Promise<MetadataRoute.Sitemap> {
  if (!isStorefrontSitemapPublished(merchant)) return [];

  try {
    const publishedHubs = await loadPublishedGamingLaptopGraphicsHubs({
      categorySlug: GAMING_LAPTOPS_CATEGORY_SLUG,
      merchantId: merchant.id,
      storeSlug: merchant.slug,
    });

    return publishedHubs.map((hub) => ({
      url: `${storeUrl}${buildGamingLaptopGraphicsHubPath(
        GAMING_LAPTOPS_CATEGORY_SLUG,
        hub.slug
      )}`,
      changeFrequency: 'daily' as const,
      priority: 0.65,
    }));
  } catch (error) {
    console.warn('Failed to load gaming graphics hub sitemap entries', {
      merchantId: merchant.id,
      error,
    });
    return [];
  }
}
