import { createClient } from '@supabase/supabase-js';
import { Feed } from 'feed';
import { unstable_cache } from 'next/cache';
import { type NextRequest, NextResponse } from 'next/server';
import { getAppUrl, getSupabaseAnonKey, getSupabaseUrl } from '@/env';
import { normalizeBlogFeedPostForFilter } from '@/lib/blog-feed-normalize';
import { getBlogStructuredDataImageUrls } from '@/lib/blog-structured-data-images';
import { stripHtml } from '@/lib/blog-utils';
import {
  filterPublicBlogPosts,
  isPublicBlogCategory,
} from '@/lib/public-blog-content-quality';
import { sanitizeForFeed } from '@/lib/sanitize';
import { stripInvalidXml10Characters } from '@/lib/sanitize-xml-10';
import { getCurrentSlugForAlias } from '@/lib/slug-alias-cache';

/**
 * Blog RSS Feed API
 *
 * Generates an RSS 2.0 feed for a merchant's published blog posts.
 * This is critical for:
 * - Google Discover eligibility
 * - Feed readers
 * - Content syndication
 * - SEO crawlers
 *
 * @see https://www.rssboard.org/rss-specification
 */

interface RouteParams {
  params: Promise<{ merchantSlug: string }>;
}

interface BlogPost {
  id: string;
  title: string;
  slug: string;
  content: string;
  excerpt: string;
  featured_image_url: string | null;
  featured_image_variants?: Record<string, unknown> | null;
  category: string | null;
  author_name: string | null;
  published_at: string | null;
  updated_at: string | null;
}

interface Merchant {
  id: string;
  slug: string;
  business_name: string;
  site_description: string | null;
  logo_url: string | null;
  custom_domain?: string | null;
}

interface MerchantRow extends Merchant {
  domains: Array<{
    domain: string;
    is_primary: boolean;
    status: string;
  }> | null;
}

interface DomainRow {
  merchant_id: string;
}

interface QueryResult<T> {
  data: T;
  error: { message: string } | null;
}

interface PublicFeedQueryBuilder {
  select(columns: string): PublicFeedQueryBuilder;
  eq(column: string, value: string): PublicFeedQueryBuilder;
  in(column: string, values: string[]): PublicFeedQueryBuilder;
  not(column: string, operator: string, value: null): PublicFeedQueryBuilder;
  order(
    column: string,
    options: { ascending: boolean }
  ): PublicFeedQueryBuilder;
  maybeSingle(): Promise<QueryResult<unknown>>;
  range(from: number, to: number): Promise<QueryResult<unknown>>;
}

interface PublicFeedClient {
  from(table: string): PublicFeedQueryBuilder;
}

const RSS_PUBLIC_POST_LIMIT = 50;
const RSS_QUERY_BATCH_SIZE = 50;
const RSS_MAX_FETCH_ITERATIONS =
  Math.ceil(RSS_PUBLIC_POST_LIMIT / RSS_QUERY_BATCH_SIZE) + 5;

// Create anonymous Supabase client for public access
function getPublicClient(): PublicFeedClient | null {
  try {
    const supabaseUrl = getSupabaseUrl();
    const supabaseAnonKey = getSupabaseAnonKey();

    return createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false },
    }) as unknown as PublicFeedClient;
  } catch {
    return null;
  }
}

function normalizeMerchantIdentifier(identifier: string): string {
  try {
    return decodeURIComponent(identifier).trim().toLowerCase();
  } catch {
    return identifier.trim().toLowerCase();
  }
}

function parseValidDate(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function getMerchantByColumn(
  supabase: PublicFeedClient,
  column: 'id' | 'slug',
  value: string
): Promise<Merchant | null> {
  const { data, error: merchantError } = await supabase
    .from('merchants')
    .select(`
        id,
        slug,
        business_name,
        site_description,
        logo_url,
        domains!left(domain, is_primary, status)
      `)
    .eq(column, value)
    .maybeSingle();

  if (merchantError) {
    console.error('Error resolving merchant for blog feed:', merchantError);
    throw merchantError;
  }

  if (!data) {
    return null;
  }

  const merchantData = data as MerchantRow;
  const domains = merchantData.domains;
  const primaryDomain = domains?.find(
    (domain) => domain.is_primary && domain.status === 'active'
  );

  return {
    id: merchantData.id,
    slug: merchantData.slug,
    business_name: merchantData.business_name,
    site_description: merchantData.site_description,
    logo_url: merchantData.logo_url,
    custom_domain: primaryDomain?.domain || null,
  };
}

async function resolveMerchantByIdentifier(
  supabase: PublicFeedClient,
  identifier: string
): Promise<Merchant | null> {
  const normalizedIdentifier = normalizeMerchantIdentifier(identifier);
  if (!normalizedIdentifier) {
    return null;
  }

  const merchantBySlug = await getMerchantByColumn(
    supabase,
    'slug',
    normalizedIdentifier
  );

  if (merchantBySlug) {
    return merchantBySlug;
  }

  const { data, error: domainError } = await supabase
    .from('domains')
    .select('merchant_id')
    .eq('domain', normalizedIdentifier)
    .eq('status', 'active')
    .in('domain_type', ['custom', 'purchased'])
    .maybeSingle();

  if (domainError) {
    console.error('Error resolving blog feed custom domain:', domainError);
    throw domainError;
  }

  if (data) {
    const domainData = data as DomainRow;
    return getMerchantByColumn(supabase, 'id', domainData.merchant_id);
  }

  // Retired-slug fallback: the merchant slug lives in the PATH here
  // (/api/blog/feed/<oldSlug>), which the proxy can't rewrite like a query param.
  // After a "Change store URL" rename, RSS readers keep hitting the old slug, so
  // resolve it to the current slug via the alias table instead of 404ing.
  const currentSlug = await getCurrentSlugForAlias(normalizedIdentifier);
  if (currentSlug && currentSlug !== normalizedIdentifier) {
    return getMerchantByColumn(supabase, 'slug', currentSlug);
  }

  return null;
}

async function fetchPublicFeedPosts(
  supabase: PublicFeedClient,
  merchantId: string
): Promise<BlogPost[]> {
  const publicPosts: BlogPost[] = [];
  let offset = 0;
  let hasMoreRows = true;
  let fetchIterations = 0;

  while (
    hasMoreRows &&
    publicPosts.length < RSS_PUBLIC_POST_LIMIT &&
    fetchIterations < RSS_MAX_FETCH_ITERATIONS
  ) {
    fetchIterations += 1;
    const { data: posts, error: postsError } = await supabase
      .from('blog_posts')
      .select(
        'id, title, slug, content, excerpt, featured_image_url, featured_image_variants, category, author_name, published_at, updated_at'
      )
      .eq('merchant_id', merchantId)
      .eq('status', 'published')
      .not('published_at', 'is', null)
      .order('published_at', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + RSS_QUERY_BATCH_SIZE - 1);

    if (postsError) {
      console.error('Error fetching blog posts for feed:', postsError);
      throw postsError;
    }

    const postBatch = Array.isArray(posts) ? (posts as BlogPost[]) : [];
    const normalizedBatch = postBatch.map(normalizeBlogFeedPostForFilter);
    publicPosts.push(...filterPublicBlogPosts(normalizedBatch));
    hasMoreRows = postBatch.length === RSS_QUERY_BATCH_SIZE;
    offset += RSS_QUERY_BATCH_SIZE;
  }

  if (
    hasMoreRows &&
    publicPosts.length < RSS_PUBLIC_POST_LIMIT &&
    fetchIterations >= RSS_MAX_FETCH_ITERATIONS
  ) {
    console.warn('Stopped blog feed fetch after max iterations', {
      merchantId,
      fetchIterations,
      collectedPosts: publicPosts.length,
    });
  }

  return publicPosts.slice(0, RSS_PUBLIC_POST_LIMIT);
}

// Cache RSS feed for 1 hour by canonical merchant id.
const getCachedFeedByMerchantId = unstable_cache(
  async (merchantId: string) => {
    const supabase = getPublicClient();
    if (!supabase) {
      throw new Error('Supabase not configured');
    }

    const merchant = await getMerchantByColumn(supabase, 'id', merchantId);

    if (!merchant) {
      return null;
    }

    return {
      merchant,
      posts: await fetchPublicFeedPosts(supabase, merchant.id),
    };
  },
  ['blog-rss-feed'],
  {
    revalidate: 3600, // 1 hour
    tags: ['blog-posts', 'blog-rss-feed'],
  }
);

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { merchantSlug } = await params;

    const supabase = getPublicClient();
    if (!supabase) {
      throw new Error('Supabase not configured');
    }

    const resolvedMerchant = await resolveMerchantByIdentifier(
      supabase,
      merchantSlug
    );

    if (!resolvedMerchant) {
      return new NextResponse('Blog feed not found', { status: 404 });
    }

    const data = await getCachedFeedByMerchantId(resolvedMerchant.id);

    if (!data) {
      return new NextResponse('Blog feed not found', { status: 404 });
    }

    const { merchant, posts } = data;

    // Base URL for the merchant's storefront
    // Use custom domain if available, otherwise fall back to slug-based URL
    const baseUrl = getAppUrl();
    const storeUrl = merchant.custom_domain
      ? `https://${merchant.custom_domain}`
      : `${baseUrl}/${merchant.slug}`;
    const feedUrl = new URL(
      `/api/blog/feed/${merchant.slug}`,
      storeUrl
    ).toString();

    const postsWithValidDates = posts.flatMap((post) => {
      const publishedDate = parseValidDate(post.published_at);
      return publishedDate ? [{ post, publishedDate }] : [];
    });

    // Build date for the channel
    const lastBuildDate =
      postsWithValidDates.length === 0
        ? null
        : (postsWithValidDates[0]?.publishedDate ?? new Date());
    const feedText = stripInvalidXml10Characters;
    const safeStoreUrl = feedText(storeUrl);
    const safeFeedUrl = feedText(feedUrl);
    const safeBaseUrl = feedText(baseUrl);

    const feed = new Feed({
      title: feedText(`${merchant.business_name} Blog`),
      description: feedText(
        merchant.site_description ||
          `Latest posts from ${merchant.business_name}`
      ),
      id: `${safeStoreUrl}/blog`,
      link: `${safeStoreUrl}/blog`,
      language: 'en',
      image: merchant.logo_url ? feedText(merchant.logo_url) : undefined,
      favicon: `${safeBaseUrl}/favicon.ico`,
      copyright: feedText(
        `All rights reserved ${new Date().getFullYear()}, ${merchant.business_name}`
      ),
      ...(lastBuildDate ? { updated: lastBuildDate } : {}),
      generator: 'Baci E-commerce Platform',
      feedLinks: {
        rss2: safeFeedUrl,
      },
      author: {
        name: feedText(merchant.business_name),
        link: safeStoreUrl,
      },
    });

    for (const { post, publishedDate } of postsWithValidDates) {
      const postUrl = `${safeStoreUrl}/blog/${encodeURIComponent(post.slug)}`;
      const excerpt = post.excerpt || stripHtml(post.content).substring(0, 300);

      const sanitizedContent = sanitizeForFeed(post.content);
      const imageUrls = getBlogStructuredDataImageUrls(post);

      feed.addItem({
        title: feedText(post.title),
        id: postUrl,
        link: postUrl,
        description: feedText(excerpt),
        content: sanitizedContent,
        author: [
          {
            name: feedText(post.author_name || merchant.business_name),
            link: safeStoreUrl,
          },
        ],
        date: publishedDate,
        image: imageUrls[0] ? feedText(imageUrls[0]) : undefined,
        category:
          post.category && isPublicBlogCategory(post.category)
            ? [{ name: feedText(post.category) }]
            : undefined,
      });
    }

    const rss = feed.rss2();

    return new NextResponse(rss, {
      headers: {
        'Content-Type': 'application/rss+xml; charset=utf-8',
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=7200',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    console.error('RSS feed error:', error);
    return new NextResponse('Error generating feed', { status: 500 });
  }
}
