import type { SupabaseClient } from '@supabase/supabase-js';
import type { BlogPostMediaRow } from '@/app/api/admin/blog/upload/blog-media-reference-scan';
import { verifyMerchantBlogPostMedia } from './merchant-blog-post-media-verify';
import { rollbackMerchantBlogPostMutation } from './rollback-merchant-blog-post-mutation';

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

type PersistBlogPostMutationBase = {
  embeddedProductIds: string[] | undefined;
  merchantId: string;
  postData: Record<string, unknown>;
  supabase: SupabaseClient;
};

type PersistBlogPostMutationInput =
  | (PersistBlogPostMutationBase & { postId: null })
  | (PersistBlogPostMutationBase & {
      existingPost: object;
      postId: string;
    });

type PersistBlogPostMutationResult =
  | { error: null; post: BlogPostMutationRecord; status: null }
  | { error: string; post: null; status: 400 | 403 | 404 | 409 | 500 };

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
): { error: string; status: 400 | 403 | 404 | 409 | 500 } {
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

export async function persistBlogPostMutation(
  args: PersistBlogPostMutationInput
): Promise<PersistBlogPostMutationResult> {
  const { embeddedProductIds, merchantId, postData, postId, supabase } = args;
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

  const { data, error } = await supabase.rpc(
    'mutate_merchant_blog_post_with_product_links',
    {
      p_merchant_id: merchantId,
      p_post_data: postData,
      p_post_id: postId,
      p_product_ids: embeddedProductIds ?? null,
    }
  );
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

  // The sweep scan snapshots references before claiming, so a merchant
  // commit landing in between loses its media. Registering the saved
  // paths resurrects unclaimed tombstones; claimed or missing paths
  // roll the save back loudly instead of persisting broken media. The
  // mutation merges per key, so unwritten variant fields fall back to
  // the pre-update snapshot exactly like the RPC does.
  const snapshot =
    postId === null ? null : (args.existingPost as Record<string, unknown>);
  const mediaRow: BlogPostMediaRow = {
    author_image_url: readNullableString(
      Object.hasOwn(postData, 'author_image_url')
        ? postData.author_image_url
        : snapshot?.author_image_url
    ),
    content: post.content,
    excerpt: post.excerpt,
    featured_image_url: post.featured_image_url,
    featured_image_variants: Object.hasOwn(postData, 'featured_image_variants')
      ? postData.featured_image_variants
      : (snapshot?.featured_image_variants ?? null),
  };
  const mediaCheck = await verifyMerchantBlogPostMedia({
    supabase,
    mediaRow,
  });
  if (mediaCheck.kind === 'failed') {
    console.error('Merchant blog post references swept media', {
      merchantId,
      postId: post.id,
      reason: mediaCheck.reason,
    });
    if (postId === null) {
      await rollbackMerchantBlogPostMutation({
        merchantId,
        mode: 'create',
        postId: post.id,
        savedMedia: mediaRow,
        supabase,
      });
    } else {
      await rollbackMerchantBlogPostMutation({
        existingPost: args.existingPost,
        merchantId,
        mode: 'update',
        postId: post.id,
        savedMedia: mediaRow,
        supabase,
      });
    }
    return {
      error: 'Referenced media was removed during save',
      post: null,
      status: 500,
    };
  }

  return { error: null, post, status: null };
}
