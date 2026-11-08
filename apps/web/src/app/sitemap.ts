import type { MetadataRoute } from 'next';
import { cookies, headers } from 'next/headers';
import { getPlatformBlogSitemapPosts } from '@/lib/platform-blog';
import { createClient } from '@/lib/supabase/server';

// Fetch active merchants for dynamic storefront URLs
async function fetchActiveMerchants() {
  try {
    const supabase = createClient(await cookies());
    const { data: merchants, error } = await supabase
      .from('merchants')
      .select('slug, updated_at')
      .not('slug', 'is', null)
      .order('updated_at', { ascending: false });

    if (error) {
      console.error('Error fetching merchants for sitemap:', error);
      return [];
    }

    return merchants || [];
  } catch (error) {
    console.error('Failed to fetch merchants:', error);
    return [];
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const headersList = await headers();
  const protocol = process.env.NODE_ENV === 'development' ? 'http' : 'https';

  const host = process.env.NEXT_PUBLIC_ROOT_DOMAIN
    ? process.env.NEXT_PUBLIC_ROOT_DOMAIN
    : headersList.get('host') || 'localhost:3000';

  const siteUrl = `${protocol}://${host}`;

  // Define static platform pages
  const staticPages = [
    { path: '/', changeFreq: 'weekly' as const, priority: 1.0 },
    { path: '/pricing', changeFreq: 'weekly' as const, priority: 0.9 },
    { path: '/features', changeFreq: 'monthly' as const, priority: 0.8 },
    { path: '/about', changeFreq: 'monthly' as const, priority: 0.7 },
    { path: '/contact', changeFreq: 'monthly' as const, priority: 0.6 },
    { path: '/blog', changeFreq: 'daily' as const, priority: 0.8 },
    { path: '/demo', changeFreq: 'monthly' as const, priority: 0.7 },
    { path: '/terms', changeFreq: 'yearly' as const, priority: 0.3 },
    { path: '/privacy', changeFreq: 'yearly' as const, priority: 0.3 },
  ];

  // Map static pages to sitemap entries
  const sitemapEntries: MetadataRoute.Sitemap = staticPages.map((page) => ({
    url: `${siteUrl}${page.path}`,
    lastModified: new Date(),
    changeFrequency: page.changeFreq,
    priority: page.priority,
  }));

  // Add dynamic platform blog posts
  try {
    const blogPosts = await getPlatformBlogSitemapPosts();
    blogPosts.forEach((post) => {
      if (!post.slug) {
        return;
      }

      const publishedAt = post.published_at
        ? new Date(post.published_at)
        : null;
      const updatedAt = post.updated_at ? new Date(post.updated_at) : null;
      const lastModified =
        updatedAt && !Number.isNaN(updatedAt.getTime())
          ? updatedAt
          : publishedAt && !Number.isNaN(publishedAt.getTime())
            ? publishedAt
            : new Date();

      sitemapEntries.push({
        url: `${siteUrl}/blog/${post.slug}`,
        lastModified,
        changeFrequency: 'weekly',
        priority: 0.7,
      });
    });
  } catch (error) {
    console.error('Failed to fetch platform blog sitemap posts:', error);
  }

  // Add merchant storefronts (for SEO discovery)
  // Note: Individual merchant sitemaps are served at /[slug]/sitemap.xml
  const merchants = await fetchActiveMerchants();
  merchants.forEach((merchant) => {
    if (merchant.slug) {
      // In development, storefronts are at /storefront/[slug]
      // In production, they're at subdomains, but we still index the main route
      const storefrontPath =
        process.env.NODE_ENV === 'development'
          ? `/storefront/${merchant.slug}`
          : `/${merchant.slug}`;

      sitemapEntries.push({
        url: `${siteUrl}${storefrontPath}`,
        lastModified: merchant.updated_at
          ? new Date(merchant.updated_at)
          : new Date(),
        changeFrequency: 'daily',
        priority: 0.6,
      });
    }
  });

  return sitemapEntries;
}
