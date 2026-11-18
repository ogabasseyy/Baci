import { createClient } from '@supabase/supabase-js';
import { unstable_cache } from 'next/cache';
import { type NextRequest, NextResponse } from 'next/server';
import { getAppUrl, getSupabaseAnonKey, getSupabaseUrl } from '@/env';
import { normalizeBlogFeedPostForFilter } from '@/lib/blog-feed-normalize';
import { isPublicBlogPost } from '@/lib/public-blog-content-quality';
import { getCurrentSlugForAlias } from '@/lib/slug-alias-cache';
import {
  getBlogPostsMerchantCacheTag,
  getBlogRssMerchantCacheTag,
  getBlogRssMerchantIdCacheTag,
} from '@/lib/tenant-cache-tags';
import {
  type BlogFeedMerchant,
  type BlogFeedPost,
  buildBlogRssFeedXml,
} from './build-blog-rss-feed';

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

type BlogPost = BlogFeedPost;
type Merchant = BlogFeedMerchant;

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
    // Judge visibility on fully normalized copies, but emit the raw slug:
    // URLs percent-encode it (identity-preserving + XML-safe) while the
    // predicate must see the same stripped text the feed renders. Pairs keep
    // each post attached to its own verdict (filterPublicBlogPosts is
    // Array.filter over this same predicate).
    const judgedBatch = postBatch.map((post) => ({
      post,
      predicate: normalizeBlogFeedPostForFilter(post),
    }));
    publicPosts.push(
      ...judgedBatch
        .filter(({ predicate }) => isPublicBlogPost(predicate))
        .map(({ post, predicate }) => ({
          ...post,
          title: predicate.title,
          category: predicate.category,
        }))
    );
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

class FeedMerchantNotFoundError extends Error {}

interface CachedMerchantFeedData {
  merchant: BlogFeedMerchant;
  posts: BlogFeedPost[];
}

const MAX_CACHED_FEED_WRAPPERS = 256;
const cachedFeedFetchers = new Map<
  string,
  () => Promise<CachedMerchantFeedData>
>();

// Memoize `unstable_cache` wrappers per merchant ID in a bounded LRU map:
// - uses Vercel's shared Data Cache (propagating `revalidateTag` across
//   instances without hitting the 1 MiB remote-cache-handler item limit),
// - bounds module-scope wrapper allocation to `MAX_CACHED_FEED_WRAPPERS`,
// - throws `FeedMerchantNotFoundError` when missing so 404s are never cached.
function getCachedFeedByMerchantId(
  merchantId: string
): Promise<CachedMerchantFeedData> {
  const normalizedMerchantId = merchantId.trim().toLowerCase();
  const existing = cachedFeedFetchers.get(normalizedMerchantId);
  if (existing) {
    cachedFeedFetchers.delete(normalizedMerchantId);
    cachedFeedFetchers.set(normalizedMerchantId, existing);
    return existing();
  }

  const fetcher = unstable_cache(
    async () => {
      const supabase = getPublicClient();
      if (!supabase) {
        throw new Error('Supabase not configured');
      }

      const merchant = await getMerchantByColumn(
        supabase,
        'id',
        normalizedMerchantId
      );

      if (!merchant) {
        throw new FeedMerchantNotFoundError('Blog feed merchant not found');
      }

      return {
        merchant,
        posts: await fetchPublicFeedPosts(supabase, merchant.id),
      };
    },
    ['blog-feed-by-merchant-id', normalizedMerchantId],
    {
      revalidate: 3600,
      tags: [
        'blog-posts',
        'blog-rss-feed',
        getBlogPostsMerchantCacheTag(normalizedMerchantId),
        getBlogRssMerchantIdCacheTag(normalizedMerchantId),
      ],
    }
  );

  if (cachedFeedFetchers.size >= MAX_CACHED_FEED_WRAPPERS) {
    const oldestKey = cachedFeedFetchers.keys().next().value;
    if (oldestKey !== undefined) {
      cachedFeedFetchers.delete(oldestKey);
    }
  }
  cachedFeedFetchers.set(normalizedMerchantId, fetcher);
  return fetcher();
}

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

    let data: CachedMerchantFeedData;
    try {
      data = await getCachedFeedByMerchantId(resolvedMerchant.id);
    } catch (error) {
      if (error instanceof FeedMerchantNotFoundError) {
        return new NextResponse('Blog feed not found', { status: 404 });
      }
      throw error;
    }

    const rss = buildBlogRssFeedXml({
      baseUrl: getAppUrl(),
      merchant: data.merchant,
      posts: data.posts,
    });

    const normalizedRequestIdentifier =
      normalizeMerchantIdentifier(merchantSlug);
    const edgeCacheTags = Array.from(
      new Set([
        'blog-posts',
        'blog-rss-feed',
        getBlogPostsMerchantCacheTag(resolvedMerchant.id),
        getBlogRssMerchantIdCacheTag(resolvedMerchant.id),
        ...(normalizedRequestIdentifier
          ? [getBlogRssMerchantCacheTag(normalizedRequestIdentifier)]
          : []),
        ...(data.merchant.slug
          ? [getBlogRssMerchantCacheTag(data.merchant.slug)]
          : []),
      ])
    );

    return new NextResponse(rss, {
      headers: {
        'Content-Type': 'application/rss+xml; charset=utf-8',
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=7200',
        'Vercel-Cache-Tag': edgeCacheTags.join(','),
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    console.error('RSS feed error:', error);
    return new NextResponse('Error generating feed', { status: 500 });
  }
}
