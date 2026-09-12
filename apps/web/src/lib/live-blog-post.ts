import { getMerchantSafe } from '@/lib/cached-data';
import { hydrateRelatedBlogProductAvailability } from '@/lib/hydrate-related-blog-product-availability';
import { normalizeStorefrontCategoryValue } from '@/lib/normalize-storefront-category-value';
import { getOrderedBlogPostProductLinks } from '@/lib/ordered-blog-post-product-links';
import {
  filterPublicBlogPosts,
  isPublicBlogPost,
} from '@/lib/public-blog-content-quality';
import { applyPublicBlogSqlFilters } from '@/lib/public-blog-sql-filters';
import {
  normalizeRelatedBlogProductLinks,
  normalizeRelatedBlogProducts,
  RELATED_BLOG_PRODUCTS_SELECT,
} from '@/lib/related-blog-products';
import { STOREFRONT_BLOG_POST_SELECT } from '@/lib/storefront-blog-post-select';
import { createPublicClient } from '@/lib/supabase/anon';

const RELATED_BLOG_POSTS_LIMIT = 3;
const RELATED_BLOG_POSTS_FETCH_LIMIT = 12;

export async function getLiveBlogPost(
  identifier: string,
  postSlug: string,
  includeDrafts: boolean = false
) {
  const normalizedPostSlug = postSlug?.trim().toLowerCase();
  if (!normalizedPostSlug) {
    return null;
  }

  const lookupKey = identifier.toLowerCase();
  const merchant = await getMerchantSafe(lookupKey);

  if (!merchant) return null;

  if (!merchant.feature_settings?.blog_enabled) return null;

  const supabase = createPublicClient({
    clientInfo: 'baci-web-live-blog-post',
    timeoutMs: 10000,
  });

  let query = supabase
    .from('blog_posts')
    .select(STOREFRONT_BLOG_POST_SELECT)
    .eq('merchant_id', merchant.id)
    .eq('slug', normalizedPostSlug);

  if (!includeDrafts) {
    query = query.eq('status', 'published').not('published_at', 'is', null);
  }

  const { data: post, error: postError } = await query.single();

  if (postError || !post) {
    if (postError && postError.code !== 'PGRST116') {
      console.error('Error fetching live blog post:', postError);
    }
    return null;
  }
  if (!includeDrafts && !isPublicBlogPost(post)) {
    return null;
  }

  let relatedQuery = supabase
    .from('blog_posts')
    .select(
      'id, title, slug, excerpt, featured_image_url, category, published_at, reading_time_minutes'
    )
    .eq('merchant_id', merchant.id)
    .eq('status', 'published')
    .not('published_at', 'is', null)
    .not('title', 'is', null)
    .not('slug', 'is', null)
    .neq('title', '')
    .neq('slug', '')
    .neq('id', post.id)
    .order('published_at', { ascending: false });

  relatedQuery = applyPublicBlogSqlFilters(relatedQuery);

  if (post.category) {
    relatedQuery = relatedQuery.eq('category', post.category);
  }

  const { data: relatedPosts, error: relatedPostsError } =
    await relatedQuery.limit(RELATED_BLOG_POSTS_FETCH_LIMIT);

  if (relatedPostsError) {
    console.error('Error fetching related live blog posts:', relatedPostsError);
  }

  const { data: linkedProducts, error: linkedProductsError } =
    await getOrderedBlogPostProductLinks(supabase, merchant.id, post.id);

  if (linkedProductsError) {
    console.error(
      'Error fetching linked live blog products:',
      linkedProductsError
    );
  }

  let normalizedRelatedProducts = linkedProductsError
    ? []
    : normalizeRelatedBlogProductLinks(linkedProducts).slice(0, 8);

  const normalizedCategorySlug = normalizeStorefrontCategoryValue(
    post.category
  );

  if (normalizedRelatedProducts.length === 0 && normalizedCategorySlug) {
    const { data: relatedProducts, error: relatedProductsError } =
      await supabase
        .from('products')
        .select(RELATED_BLOG_PRODUCTS_SELECT)
        .eq('merchant_id', merchant.id)
        .eq('status', 'active')
        .eq('categories.slug', normalizedCategorySlug)
        .order('updated_at', { ascending: false })
        .limit(6);

    if (relatedProductsError) {
      console.error(
        'Error fetching related live blog products:',
        relatedProductsError
      );
    }

    normalizedRelatedProducts = relatedProductsError
      ? []
      : normalizeRelatedBlogProducts(relatedProducts);
  }

  normalizedRelatedProducts = await hydrateRelatedBlogProductAvailability(
    supabase,
    normalizedRelatedProducts,
    { merchantId: merchant.id }
  );

  return {
    merchant: {
      id: merchant.id,
      business_name: merchant.business_name,
      slug: merchant.slug,
      logo_url: merchant.logo_url,
      custom_domain: merchant.custom_domain,
      country: merchant.country,
      payout_currency: merchant.payout_currency,
      social_media: merchant.social_media,
    },
    post,
    relatedPosts: relatedPostsError
      ? []
      : filterPublicBlogPosts(relatedPosts ?? []).slice(
          0,
          RELATED_BLOG_POSTS_LIMIT
        ),
    relatedProducts: normalizedRelatedProducts,
  };
}
