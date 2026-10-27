import type { SupabaseClient } from '@supabase/supabase-js';
import { cacheLife, cacheTag } from 'next/cache';
import { createPublicClient } from '@/lib/supabase/public';
import type {
  BuildCommercialGuideLinksContext,
  PublishedClusterPost,
} from './content-cluster-types';
import { buildStorefrontClusterGuideRequest } from './storefront-cluster-guide-request';

const CLUSTER_GUIDE_CANDIDATE_LIMIT = 64;

// Optional overlay read: bound it and disable PostgREST auto-retry so a slow
// response cannot fan out into 4 attempts (~34s). See the retry note below.
const CLUSTER_GUIDE_TIMEOUT_MS = 3_000;
type StorefrontClusterGuideDatabase = {
  public: {
    Tables: Record<string, never>;
    Views: Record<string, never>;
    Functions: {
      get_storefront_cluster_guide_candidates_v2: {
        Args: {
          p_category_slug: string;
          p_cluster_rules: ReturnType<
            typeof buildStorefrontClusterGuideRequest
          >['p_cluster_rules'];
          p_merchant_id: string;
          p_search_query: string;
          p_limit?: number;
        };
        Returns: PublishedClusterPost[];
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

/**
 * Loads only context-relevant public guide candidates from the database.
 *
 * Cached LOCALLY — deliberately `'use cache'`, not `'use cache: remote'`. The
 * prior rejection (see git history on this file / PR #3017) targeted an
 * UNBOUNDED ~400KB `'use cache: remote'` entry that cached a merchant's
 * entire published blog corpus and was re-written to Vercel's managed data
 * cache every 60s; that remote-write path (RemoteCacheHandler 502/503 ->
 * unhandled rejection -> process exit) was the dominant source of storefront
 * cache failures, independent of this function's argument shape. The RPC
 * below already bounds every response to <=64 relevance-ranked rows via
 * SQL LIMIT, so the unbounded-payload condition no longer holds, and a local
 * entry never takes the remote write path at all. Cache Components keys each
 * entry on the full argument tuple (merchantId + context), so a product/
 * compare/category/price-band request can never be served another request's
 * cached rows.
 *
 * Errors escape so the page-level optional-content boundary can fail open
 * without persisting an empty result.
 */
export async function getPublishedClusterPosts(
  merchantId: string,
  context: BuildCommercialGuideLinksContext
): Promise<PublishedClusterPost[]> {
  'use cache';
  try {
    // 'blog' (revalidate 3600, expire 86400): matches getCachedBlogPost — this
    // read is bounded and index-backed, so the merchant-wide unbounded-payload
    // condition that forced the old cache off a long revalidate window no
    // longer applies. Tag parity with getCachedBlogPost/revalidateBlogPosts
    // (`blog-posts`), revalidateProducts (`products-${merchantId}`), and
    // revalidateFeatures (`features-${merchantId}`, since the blog_enabled
    // gate now lives inside the RPC instead of a nested cached call) so a
    // post publish/edit or a blog_enabled toggle busts every cached context
    // for this merchant instead of waiting out the TTL.
    cacheLife('blog');
    cacheTag('blog-posts', `products-${merchantId}`, `features-${merchantId}`);
  } catch {
    // Unit tests do not run with Next cacheComponents enabled.
  }

  // The repository has not generated a global Database type yet. Keep the
  // assertion at this RPC adapter boundary so Supabase can type the set-return
  // contract correctly; overrideTypes() cannot turn the default scalar Json
  // fallback for an unknown RPC into an array on current postgrest-js.
  const supabase = createPublicClient({
    clientInfo: 'baci-web-storefront-cluster-guides',
    timeoutMs: CLUSTER_GUIDE_TIMEOUT_MS,
  }) as SupabaseClient<StorefrontClusterGuideDatabase>;
  const request = buildStorefrontClusterGuideRequest(context);
  const guideQuery = supabase
    .rpc('get_storefront_cluster_guide_candidates_v2', {
      p_category_slug: request.p_category_slug,
      p_cluster_rules: request.p_cluster_rules,
      p_merchant_id: merchantId,
      p_search_query: request.p_search_query,
      p_limit: CLUSTER_GUIDE_CANDIDATE_LIMIT,
    })
    .abortSignal(AbortSignal.timeout(CLUSTER_GUIDE_TIMEOUT_MS));

  // Disable PostgREST auto-retry. The shared client bounds each fetch with
  // AbortSignal.timeout(), which rejects with a native `TimeoutError` (not
  // `AbortError`); postgrest-js 2.108.2 only suppresses retries for AbortError,
  // so a timeout on this optional per-request read would otherwise become 4
  // attempts with 1/2/4s backoff (~34s). One bounded attempt, then the caller's
  // optional-content boundary fails open. See getCachedProductSemanticInventory.
  const boundedGuideQuery =
    typeof guideQuery.retry === 'function'
      ? guideQuery.retry(false)
      : guideQuery;

  const { data, error } = await boundedGuideQuery;

  if (error) {
    throw error;
  }

  return data ?? [];
}
