import type { SupabaseClient } from '@supabase/supabase-js';
import { cacheLife, cacheTag } from 'next/cache';
import { createPublicClient } from '@/lib/supabase/public';
import type {
  MerchantBlogIntent,
  MerchantBlogIntentSource,
  PublishedClusterPost,
} from './content-cluster-types';

const CLASSIFICATION_BATCH_LIMIT = 200;
const CLASSIFICATION_TIMEOUT_MS = 3_000;

interface ClusterPostInput
  extends Omit<PublishedClusterPost, 'tags' | 'keywords'> {
  id: string;
  classification_revision?: string | null;
  tags?: string[] | null;
  keywords?: string[] | null;
}

interface CurrentClassification {
  post_id: string;
  intent: MerchantBlogIntent;
  source: MerchantBlogIntentSource;
  post_revision: string;
}

type ClassificationDatabase = {
  public: {
    Tables: Record<string, never>;
    Views: Record<string, never>;
    Functions: {
      get_storefront_blog_classifications_v1: {
        Args: { p_merchant_id: string; p_post_ids: string[] };
        Returns: unknown[];
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

function isCurrentClassification(
  value: unknown
): value is CurrentClassification {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.post_id === 'string' &&
    typeof row.post_revision === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      row.post_revision
    ) &&
    (row.intent === 'news' ||
      row.intent === 'comparison' ||
      row.intent === 'repair-guide' ||
      row.intent === 'buying-guide') &&
    (row.source === 'merchant_declared' ||
      row.source === 'verified_receipt' ||
      row.source === 'reviewed')
  );
}

async function getCurrentClassifications(
  merchantId: string,
  postIds: string[]
) {
  'use cache';
  try {
    cacheLife('merchant');
    cacheTag('blog-posts', `features-${merchantId}`);
  } catch {
    // Unit tests run outside the Next cacheComponents runtime.
  }
  const supabase = createPublicClient({
    clientInfo: 'baci-web-blog-classifications',
    timeoutMs: CLASSIFICATION_TIMEOUT_MS,
  }) as SupabaseClient<ClassificationDatabase>;
  const query = supabase
    .rpc('get_storefront_blog_classifications_v1', {
      p_merchant_id: merchantId,
      p_post_ids: postIds,
    })
    .abortSignal(AbortSignal.timeout(CLASSIFICATION_TIMEOUT_MS));
  // A timeout must remain a single optional read, not four retry attempts.
  const { data, error } = await query.retry(false);
  if (error) throw new Error('Blog classification read failed');
  return (data ?? []).filter(isCurrentClassification);
}

/**
 * Project listing/detail rows for cluster consumers, then overlay only current
 * classifications returned by the published-only RPC. Failure falls back outside
 * the cache so a transient outage cannot persist an unclassified result.
 */

export async function loadClassifiedClusterPosts(
  merchantId: string,
  posts: ClusterPostInput[]
): Promise<PublishedClusterPost[]> {
  const projected = posts.map(
    (post): PublishedClusterPost => ({
      slug: post.slug,
      title: post.title,
      excerpt: post.excerpt,
      category: post.category,
      tags: post.tags ?? null,
      keywords: post.keywords ?? null,
      featured_image_url: post.featured_image_url,
      published_at: post.published_at,
      reading_time_minutes: post.reading_time_minutes,
    })
  );
  if (posts.length === 0) return projected;
  const postIds = [
    ...new Set(
      posts
        .filter(
          (post) =>
            post.classification_revision &&
            /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
              post.classification_revision
            )
        )
        .map((post) => post.id)
    ),
  ].sort();
  if (postIds.length === 0 || postIds.length > CLASSIFICATION_BATCH_LIMIT) {
    return projected;
  }

  try {
    const rows = await getCurrentClassifications(merchantId, postIds);
    const byPost = new Map(rows.map((row) => [row.post_id, row]));
    return projected.map((post, index) => {
      const original = posts[index];
      const classification = byPost.get(original.id);
      // Independently cached content must not receive metadata for a newer
      // content revision. updated_at is intentionally ignored because reads
      // such as view-count increments also update that general-purpose field.
      if (
        !classification ||
        !original.classification_revision ||
        classification.post_revision !== original.classification_revision
      ) {
        return post;
      }
      return {
        ...post,
        merchant_intent: classification.intent,
        merchant_intent_source: classification.source,
      };
    });
  } catch {
    console.warn('Optional merchant blog classification unavailable', {
      merchantId,
    });
    return projected;
  }
}
