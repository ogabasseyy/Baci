import type { MetadataRoute } from 'next';
import { listEligibleAuthorityHubs } from '@/lib/storefront-category/list-eligible-authority-hubs';
import { isStorefrontSitemapPublished } from '@/lib/storefront-seo/is-storefront-sitemap-published';
import type { StorefrontSitemapContext } from './sitemap-data';

export async function getBrandAuthoritySitemapEntries({
  merchant,
  storeUrl,
}: StorefrontSitemapContext): Promise<MetadataRoute.Sitemap> {
  if (!isStorefrontSitemapPublished(merchant)) {
    return [];
  }

  const hubs = await listEligibleAuthorityHubs(merchant.id);
  return hubs.flatMap((hub) => {
    const brandUrl = `${storeUrl}/${hub.categorySlug}/brands/${hub.brandKey}`;
    const lastModified = hub.latestUpdatedAt
      ? new Date(hub.latestUpdatedAt)
      : undefined;
    return [
      {
        url: brandUrl,
        lastModified,
        changeFrequency: 'daily' as const,
        priority: 0.7,
      },
      ...hub.familyKeys.map((familyKey) => ({
        url: `${brandUrl}/families/${familyKey}`,
        lastModified,
        changeFrequency: 'daily' as const,
        priority: 0.65,
      })),
    ];
  });
}
