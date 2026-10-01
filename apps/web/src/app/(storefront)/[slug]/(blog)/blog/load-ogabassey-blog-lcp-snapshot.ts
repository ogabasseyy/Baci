import 'server-only';
import { getBlogListingImageSrc } from '@/components/storefront/ogabassey/pages/blog-listing-image-src';
import { OGABASSEY_MERCHANT_ID, OGABASSEY_URL } from '@/config/ogabassey';
import { BLOG_LISTING_PAGE_SIZE } from '@/lib/blog-listing-page-size';
import { filterPublicBlogPosts } from '@/lib/public-blog-content-quality';
import { applyPublicBlogSqlFilters } from '@/lib/public-blog-sql-filters';
import { getPublicSupabaseClient } from '@/lib/public-supabase-client';
import type { BlogPostData } from '@/templates/registry';
import { buildBlogListingFeaturedStory } from './blog-listing-featured-story';
import { getBlogListingHeroPost } from './blog-listing-hero-image-preload';

const OGABASSEY_BLOG_LCP_MERCHANT_NAME = 'Ogabassey';
const BLOG_LCP_SNAPSHOT_SELECT =
  'id, title, slug, excerpt, featured_image_url, category, author_name, published_at, reading_time_minutes';

export interface OgabasseyBlogLcpSnapshot {
  basePath: string;
  featuredPost: BlogPostData;
  imageSrc: string;
  publishedDateLabel: string;
}

function shouldSkipSnapshotLoad(): boolean {
  return process.env.BACI_STOREFRONT_BUILD_READS === 'offline';
}

/**
 * Uncached first-page listing read used to refresh
 * `ogabassey-blog-lcp-snapshot.json`.
 *
 * Must not use `'use cache'` or `getCachedBlogListing`: those require an App
 * Router WorkStore. Do not top-level-await this from `loading.tsx` or the
 * page fallback — that postponed leaf loading so the parent [slug] slot
 * painted "Loading storefront chrome" and hid the featured `<picture>`.
 */
export async function loadOgabasseyBlogLcpSnapshot(): Promise<OgabasseyBlogLcpSnapshot | null> {
  if (shouldSkipSnapshotLoad()) {
    return null;
  }

  try {
    const supabase = getPublicSupabaseClient();
    let query = supabase
      .from('blog_posts')
      .select(BLOG_LCP_SNAPSHOT_SELECT)
      .eq('merchant_id', OGABASSEY_MERCHANT_ID)
      .eq('status', 'published')
      .not('published_at', 'is', null)
      .not('title', 'is', null)
      .not('slug', 'is', null)
      .neq('title', '')
      .neq('slug', '')
      .order('published_at', { ascending: false })
      .order('id', { ascending: true });

    query = applyPublicBlogSqlFilters(query);

    const { data: posts, error } = await query.range(
      0,
      BLOG_LISTING_PAGE_SIZE - 1
    );

    if (error) {
      throw error;
    }

    const heroPost = getBlogListingHeroPost(filterPublicBlogPosts(posts || []));
    if (!heroPost?.slug || !heroPost.title) {
      return null;
    }

    const { featuredPost, publishedDateLabel } = buildBlogListingFeaturedStory(
      {
        id: heroPost.id,
        title: heroPost.title,
        slug: heroPost.slug,
        excerpt: heroPost.excerpt,
        category: heroPost.category,
        author_name: heroPost.author_name,
        published_at: heroPost.published_at,
        featured_image_url: heroPost.featured_image_url,
        reading_time_minutes: heroPost.reading_time_minutes,
      },
      OGABASSEY_BLOG_LCP_MERCHANT_NAME
    );

    return {
      basePath: OGABASSEY_URL,
      featuredPost,
      imageSrc: getBlogListingImageSrc(featuredPost.featured_image_url),
      publishedDateLabel,
    };
  } catch (error) {
    console.warn('Ogabassey blog LCP snapshot unavailable', { error });
    return null;
  }
}
