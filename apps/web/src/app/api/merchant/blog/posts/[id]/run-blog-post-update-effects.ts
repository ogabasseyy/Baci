import type { SupabaseClient } from '@supabase/supabase-js';
import { revalidateBlogPosts } from '@/lib/cache-revalidation';
import { getBlogEmbeddingText } from '@/lib/embeddings';
import { getMerchantBlogRevalidationContext } from '@/lib/get-merchant-blog-cache-identifiers';
import { scheduleUpdatedPostEffects } from './updated-post-effects';

type BlogPostUpdateEffectRecord = {
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

export async function runBlogPostUpdateEffects({
  existingCategory,
  existingSlug,
  existingStatus,
  featuredImageUrlChanged,
  merchantId,
  shouldRegenerateEmbedding,
  supabase,
  updatedPost,
}: {
  existingCategory: string | null;
  existingSlug: string;
  existingStatus: string;
  featuredImageUrlChanged: boolean;
  merchantId: string;
  shouldRegenerateEmbedding: boolean;
  supabase: SupabaseClient;
  updatedPost: BlogPostUpdateEffectRecord;
}) {
  if (shouldRegenerateEmbedding) {
    const embeddingText = getBlogEmbeddingText({
      title: updatedPost.title,
      excerpt: updatedPost.excerpt,
      content: updatedPost.content,
      category: updatedPost.category,
    });
    void supabase.functions
      .invoke('generate-embedding', {
        body: {
          id: updatedPost.id,
          text: embeddingText,
          type: 'blog',
        },
      })
      .then(({ error }) => {
        if (error) {
          console.error('Failed to regenerate blog embedding:', error);
        }
      })
      .catch((error) =>
        console.error('Failed to regenerate blog embedding:', error)
      );
  }

  let blogRevalidation:
    | Awaited<ReturnType<typeof getMerchantBlogRevalidationContext>>
    | undefined;
  try {
    blogRevalidation = await getMerchantBlogRevalidationContext(
      supabase,
      merchantId
    );
    revalidateBlogPosts({
      merchantId,
      identifiers: blogRevalidation.identifiers,
      canonicalMerchantSlug: blogRevalidation.canonicalMerchantSlug,
      listingCategories: [existingCategory, updatedPost.category].filter(
        (category): category is string => Boolean(category)
      ),
      postSlugs: [existingSlug, updatedPost.slug],
    });
  } catch (error) {
    console.error('Failed post-publication blog revalidation:', {
      merchantId,
      postSlug: updatedPost.slug,
      error,
    });
  }

  scheduleUpdatedPostEffects({
    blogRevalidation,
    featuredImageUrlChanged,
    post: updatedPost,
    publishingNow:
      updatedPost.status === 'published' && existingStatus !== 'published',
    supabase,
  });
}
