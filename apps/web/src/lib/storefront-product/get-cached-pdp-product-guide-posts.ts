import { cacheLife, cacheTag } from 'next/cache';
import { createStorefrontReadDeadline } from '@/lib/create-storefront-read-deadline';
import { prepareStorefrontSingleAttemptQuery } from '@/lib/prepare-storefront-single-attempt-query';
import { getPublicSupabaseClient } from '@/lib/public-supabase-client';
import type { PublishedClusterPost } from '@/lib/storefront-content/content-cluster-types';
import { isPublishedClusterPost } from '@/lib/storefront-content/is-published-cluster-post';

const PDP_PRODUCT_GUIDE_LIMIT = 8;
const PDP_PRODUCT_GUIDE_TIMEOUT_MS = 3_000;

type LinkedBlogPost = PublishedClusterPost & { status?: string | null };

interface LinkedBlogPostRow {
  blog_posts: LinkedBlogPost | LinkedBlogPost[] | null;
}

function normalizeLinkedPost(
  row: LinkedBlogPostRow
): PublishedClusterPost | null {
  const post = Array.isArray(row.blog_posts)
    ? row.blog_posts[0]
    : row.blog_posts;
  if (!post) return null;

  if (!isPublishedClusterPost(post)) return null;
  const slug = post.slug.trim();
  const title = post.title.trim();

  return {
    category: post.category,
    excerpt: post.excerpt,
    featured_image_url: post.featured_image_url,
    keywords: post.keywords,
    published_at: post.published_at,
    reading_time_minutes: post.reading_time_minutes,
    slug,
    tags: post.tags,
    title,
  };
}

/**
 * Loads product-linked guides independently from the category inventory.
 *
 * This stays on the local cache handler. Product ids are high-cardinality and
 * the repository has an established failure mode where remote cache SETs can
 * hang under crawler load. A bounded indexed read plus local cache avoids both
 * the old combined-RPC timeout and a new remote-cache write on every PDP.
 */
export function getCachedPdpProductGuidePosts(
  merchantId: string,
  productId: string
): Promise<PublishedClusterPost[]> {
  if (typeof productId !== 'string' || productId.trim() === '') {
    return Promise.resolve([]);
  }
  return getCachedPdpProductGuidePostsForValidProduct(merchantId, productId);
}

async function getCachedPdpProductGuidePostsForValidProduct(
  merchantId: string,
  productId: string
): Promise<PublishedClusterPost[]> {
  'use cache';

  try {
    cacheLife('blog');
    cacheTag(
      'blog-posts',
      `products-${merchantId}`,
      `published-product-guide-posts-${merchantId}-${productId}`
    );
  } catch {
    // Unit tests do not run with Next cacheComponents enabled.
  }

  const query = getPublicSupabaseClient()
    .from('blog_post_products')
    .select(
      'blog_posts!inner(slug, title, excerpt, category, tags, keywords, featured_image_url, published_at, reading_time_minutes, status)'
    )
    .eq('merchant_id', merchantId)
    .eq('product_id', productId)
    .eq('blog_posts.merchant_id', merchantId)
    .eq('blog_posts.status', 'published')
    .not('blog_posts.published_at', 'is', null)
    .order('created_at', { ascending: false })
    .limit(PDP_PRODUCT_GUIDE_LIMIT);
  const deadline = createStorefrontReadDeadline(PDP_PRODUCT_GUIDE_TIMEOUT_MS);
  try {
    const queryPromise = Promise.resolve(
      prepareStorefrontSingleAttemptQuery(query, deadline.signal)
    );
    const { data, error } = await Promise.race([
      queryPromise,
      deadline.promise,
    ]);

    if (error) throw error;

    return ((data ?? []) as LinkedBlogPostRow[])
      .map(normalizeLinkedPost)
      .filter((post): post is PublishedClusterPost => post !== null);
  } finally {
    deadline.cleanup();
  }
}
