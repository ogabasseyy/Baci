import type { MetadataRoute } from 'next';
import { cookies, headers } from 'next/headers';
import { getPlatformBlogSitemapPosts } from '@/lib/platform-blog';
import { createClient } from '@/lib/supabase/server';

interface SitemapDomain {
  domain: string | null;
  status: string | null;
  domain_type: string | null;
  is_primary?: boolean | null;
}

interface SitemapMerchant {
  slug: string | null;
  updated_at: string | null;
  domains?: SitemapDomain | SitemapDomain[] | null;
}

/**
 * Fetches active merchants for dynamic storefront URLs.
 *
 * RLS policy note:
 * Queries `merchants` and its nested `domains` relation using the standard
 * `createClient(await cookies())` (anon role). `public.domains` has the
 * `domains_select_policy` RLS policy in PostgreSQL permitting anon reads
 * for active verified domains. Downstream, `hasActiveCustomDomain` verifies
 * active status and custom/purchased domain type to omit merchants whose canonical
 * storefront URL is served by their own custom domain.
 */
async function fetchActiveMerchants(): Promise<SitemapMerchant[]> {
  try {
    const supabase = createClient(await cookies());
    const { data: merchants, error } = await supabase
      .from('merchants')
      .select(
        // Active domains are permitted under domains_select_policy RLS
        'slug, updated_at, domains(domain, status, domain_type, is_primary)'
      )
      .eq('is_published', true)
      .not('slug', 'is', null)
      .order('updated_at', { ascending: false });

    if (error) {
      console.error('Error fetching merchants for sitemap:', error);
      return [];
    }

    return ((merchants as SitemapMerchant[] | null) || []).filter(
      (merchant) => {
        const domainRows = Array.isArray(merchant.domains)
          ? merchant.domains
          : merchant.domains
            ? [merchant.domains]
            : [];
        const hasActiveCustomDomain = domainRows.some((d) => {
          const status = d.status?.trim().toLowerCase();
          const domainType = d.domain_type?.trim().toLowerCase();
          return (
            status === 'active' &&
            (domainType === 'custom' || domainType === 'purchased') &&
            Boolean(d.domain?.trim())
          );
        });
        return !hasActiveCustomDomain;
      }
    );
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
            : undefined;

      sitemapEntries.push({
        url: `${siteUrl}/blog/${post.slug}`,
        ...(lastModified && { lastModified }),
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

      const updatedAt = merchant.updated_at
        ? new Date(merchant.updated_at)
        : null;
      const lastModified =
        updatedAt && !Number.isNaN(updatedAt.getTime()) ? updatedAt : undefined;

      sitemapEntries.push({
        url: `${siteUrl}${storefrontPath}`,
        ...(lastModified && { lastModified }),
        changeFrequency: 'daily',
        priority: 0.6,
      });
    }
  });

  return sitemapEntries;
}
