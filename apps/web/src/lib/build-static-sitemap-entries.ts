import type { MetadataRoute } from 'next';
import { STATIC_SITEMAP_PAGES } from '@/config/static-sitemap-pages';

export function buildStaticSitemapEntries(
  siteUrl: string
): MetadataRoute.Sitemap {
  return STATIC_SITEMAP_PAGES.map((page) => ({
    url: `${siteUrl}${page.path}`,
    changeFrequency: page.changeFreq,
    priority: page.priority,
  }));
}
