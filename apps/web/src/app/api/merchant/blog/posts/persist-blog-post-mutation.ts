import type { SupabaseClient } from '@supabase/supabase-js';
import type { BlogPostMediaRow } from '@/app/api/admin/blog/upload/blog-media-reference-scan';
import { blogPostMediaPaths } from '@/app/api/admin/blog/upload/blog-media-tombstone-clear';

type BlogPostMutationRecord = {
  category: string | null;
  content: string;
  excerpt: string | null;
  featured_image_url: string | null;
  id: string;
  merchant_id: string;
  published_at: string | null;
  slug: string;
  status: string;
  title: string;
};

type PersistBlogPostMutationInput = {
  embeddedProductIds: string[] | undefined;
  merchantId: string;
  postData: Record<string, unknown>;
  postId: string | null;
  reschedulePublishAt?: string;
  supabase: SupabaseClient;
};

type PersistBlogPostMutationResult =
  | { error: null; post: BlogPostMutationRecord; status: null }
  | {
      code?: string;
      error: string;
      post: null;
      status: 400 | 403 | 404 | 409 | 500;
    };

function readString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function readNullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function readRpcMutationError(
  error: {
    code?: string;
    details?: string;
    message?: string;
  } | null
): {
  code?: string;
  error: string;
  status: 400 | 403 | 404 | 409 | 500;
} {
  if (
    error?.code === '42501' &&
    error.message?.includes('scheduled_reservation_requires_reschedule_rpc')
  ) {
    return {
      code: 'scheduled_reservation_requires_reschedule_rpc',
      error: 'Reserved post schedule must be updated via the reschedule RPC',
      status: 409,
    };
  }
  if (
    error?.code === 'P0002' &&
    error.message === 'embedded_product_not_found_or_not_owned'
  ) {
    return {
      error: 'One or more embedded products do not belong to this merchant',
      status: 400,
    };
  }
  if (error?.code === 'P0002' && error.message === 'blog_post_not_found') {
    return { error: 'Post not found', status: 404 };
  }
  if (
    error?.code === '42501' &&
    (error.message === 'merchant_marketing_create_permission_required' ||
      error.message === 'merchant_marketing_edit_permission_required')
  ) {
    return { error: 'Permission denied', status: 403 };
  }
  if (
    error?.code === '23505' &&
    (error.message?.includes('blog_posts_merchant_id_slug_key') ||
      error.details?.includes('(merchant_id, slug)'))
  ) {
    return { error: 'A post with this slug already exists', status: 409 };
  }
  if (
    error?.code === 'P0001' &&
    error.message?.includes('merchant_blog_media_swept_during_save')
  ) {
    return {
      error: 'Referenced media was removed during save',
      status: 500,
    };
  }
  if (
    error?.code === '42501' &&
    error.message?.includes('blog_release_access_denied')
  ) {
    return { error: 'Permission denied', status: 403 };
  }
  if (error?.code === 'P0002') {
    return { error: 'Post or active reservation not found', status: 404 };
  }
  if (
    error?.code === '22023' ||
    error?.message?.includes('outside_publish_window_lagos') ||
    error?.message?.includes('invalid_reschedule_input') ||
    error?.message?.includes('blog_post_archived') ||
    error?.message?.includes('fast_track_event_timestamp_required') ||
    error?.message?.includes('fast_track_event_in_future') ||
    error?.message?.includes('fast_track_news_expired') ||
    error?.message?.includes('fast_track_outside_lagos_window')
  ) {
    return {
      error: error.message || 'Invalid schedule timestamp',
      status: 400,
    };
  }
  if (
    error?.code === '40001' ||
    error?.message?.includes('daily_cap_exceeded') ||
    error?.message?.includes('fast_track_cap_exceeded') ||
    error?.message?.includes('low_demand_game_software_cap_exceeded') ||
    error?.message?.includes('evergreen_reserve_required') ||
    error?.message?.includes('evergreen_reserve_protected') ||
    error?.message?.includes('min_spacing_conflict') ||
    error?.message?.includes('min_spacing_active') ||
    error?.message?.includes('reschedule_request_digest_mismatch') ||
    error?.message?.includes('active_reservation_already_exists') ||
    error?.message?.includes('article_identity_conflict') ||
    error?.message?.includes('article_identity_already_assigned') ||
    error?.message?.includes('blog_post_already_published') ||
    error?.message?.includes('blog_post_article_identity_immutable') ||
    error?.message?.includes('cannot_reschedule_published_blog_post') ||
    error?.message?.includes('cannot_cancel_published_blog_post') ||
    error?.message?.includes('reservation_request_payload_mismatch')
  ) {
    return {
      error: error.message || 'Schedule conflicts with blog release policy',
      status: 409,
    };
  }
  return { error: 'Failed to persist post', status: 500 };
}

function readMutationPost({
  fallback,
  merchantId,
  value,
}: {
  fallback: Record<string, unknown>;
  merchantId: string;
  value: unknown;
}): BlogPostMutationRecord | null {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;

  const post = row as Record<string, unknown>;
  if (typeof post.id !== 'string') return null;

  return {
    category: readNullableString(
      Object.hasOwn(post, 'category') ? post.category : fallback.category
    ),
    content: readString(post.content, readString(fallback.content)),
    excerpt: readNullableString(
      Object.hasOwn(post, 'excerpt') ? post.excerpt : fallback.excerpt
    ),
    featured_image_url: readNullableString(
      Object.hasOwn(post, 'featured_image_url')
        ? post.featured_image_url
        : fallback.featured_image_url
    ),
    id: post.id,
    merchant_id: readString(post.merchant_id, merchantId),
    published_at: readNullableString(
      Object.hasOwn(post, 'published_at')
        ? post.published_at
        : fallback.published_at
    ),
    slug: readString(post.slug, readString(fallback.slug)),
    status: readString(post.status, readString(fallback.status, 'draft')),
    title: readString(post.title, readString(fallback.title)),
  };
}

export async function persistBlogPostMutation({
  embeddedProductIds,
  merchantId,
  postData,
  postId,
  reschedulePublishAt,
  supabase,
}: PersistBlogPostMutationInput): Promise<PersistBlogPostMutationResult> {
  if (embeddedProductIds && embeddedProductIds.length > 0) {
    const { data: products, error: productsError } = await supabase
      .from('products')
      .select('id')
      .eq('merchant_id', merchantId)
      .in('id', embeddedProductIds);
    if (productsError) {
      console.error('Failed to validate embedded blog products:', {
        merchantId,
        error: productsError,
      });
      return {
        error: 'Failed to validate embedded products',
        post: null,
        status: 500,
      };
    }

    const ownedProductIds = new Set(
      (products ?? []).flatMap((product) =>
        product && typeof product.id === 'string' ? [product.id] : []
      )
    );
    if (ownedProductIds.size !== embeddedProductIds.length) {
      return {
        error: 'One or more embedded products do not belong to this merchant',
        post: null,
        status: 400,
      };
    }
  }

  // The sweep scan snapshots references before claiming, so paths this
  // save newly references can lose the race. The mutation verifies
  // them atomically: registration resurrects unclaimed tombstones
  // inside the same transaction, and claimed or missing paths abort
  // the post and its links together. Unchanged fields stay
  // continuously referenced, so only this payload's paths matter.
  const savedMediaRow: BlogPostMediaRow = {
    author_image_url: readNullableString(postData.author_image_url),
    content: readString(postData.content),
    excerpt: readNullableString(postData.excerpt),
    featured_image_url: readNullableString(postData.featured_image_url),
    featured_image_variants: postData.featured_image_variants ?? null,
  };
  const mediaPaths = blogPostMediaPaths(savedMediaRow);
  const { data, error } =
    typeof reschedulePublishAt === 'string' && postId !== null
      ? await supabase.rpc('reschedule_and_mutate_merchant_blog_post_v1', {
          p_media_paths: mediaPaths,
          p_merchant_id: merchantId,
          p_new_requested_publish_at: reschedulePublishAt,
          p_post_data: postData,
          p_post_id: postId,
          p_product_ids: embeddedProductIds ?? null,
        })
      : await supabase.rpc('mutate_merchant_blog_post_with_product_links', {
          p_media_paths: mediaPaths,
          p_merchant_id: merchantId,
          p_post_data: postData,
          p_post_id: postId,
          p_product_ids: embeddedProductIds ?? null,
        });
  const post = readMutationPost({
    fallback: postData,
    merchantId,
    value: data,
  });
  if (error || !post) {
    const mappedError = readRpcMutationError(error);
    console.error('Failed to persist embedded blog products:', {
      merchantId,
      postId,
      error,
    });
    return {
      code: error === null ? undefined : mappedError.code,
      error:
        error === null
          ? postId
            ? 'Failed to update post'
            : 'Failed to create post'
          : mappedError.error,
      post: null,
      status: error === null ? 500 : mappedError.status,
    };
  }

  return { error: null, post, status: null };
}
