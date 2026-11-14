import type { SupabaseClient } from '@supabase/supabase-js';
import type { PublishedClusterPost } from '@/lib/storefront-content/content-cluster-types';
import type { StorefrontClusterGuideRequest } from '@/lib/storefront-content/storefront-cluster-guide-request';
import { createStorefrontPdpSemanticCooldownResult } from '@/lib/storefront-product/create-storefront-pdp-semantic-cooldown-result';
import { PDP_SEMANTIC_INVENTORY_LIMIT } from '@/lib/storefront-product/pdp-semantic-inventory-limit';
import { runStorefrontPdpSemanticRpcWithCooldown } from '@/lib/storefront-product/run-storefront-pdp-semantic-rpc-with-cooldown';
import { storefrontPdpSemanticReadCooldown } from '@/lib/storefront-product/storefront-pdp-semantic-read-cooldown-singleton';
import type { StorefrontDatabase } from '@/types/storefront-database';
import type { Json } from '@/types/supabase';
import {
  resolveStorefrontReadResult,
  type StorefrontReadResult,
} from '../storefront-read-result';
import type { ProductSemanticCandidate } from './product-semantic-types';
import { parseInventory } from './storefront-pdp-semantic-candidate-parser';

const PDP_SEMANTIC_ENRICHMENT_TOTAL_DEADLINE_MS = 5_000;
const PDP_SEMANTIC_ENRICHMENT_TRACE_THRESHOLD_MS = 4_000;
const PDP_SEMANTIC_CLUSTER_GUIDE_LIMIT = 48;
const PDP_SEMANTIC_PRODUCT_GUIDE_LIMIT = 8;

export interface ProductSeoLinkData {
  guidePosts: PublishedClusterPost[];
  inventory: ProductSemanticCandidate[];
  priorityGuidePostSlugs: string[];
}

interface ReadStorefrontPdpSemanticEnrichmentInput {
  clusterRequest: StorefrontClusterGuideRequest;
  includeGuides: boolean;
  merchantId: string;
  productId: string;
}

function isJsonObject(value: Json): value is Record<string, Json | undefined> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNullableString(value: Json | undefined): value is string | null {
  return value === null || typeof value === 'string';
}

function isNullableStringArray(
  value: Json | undefined
): value is string[] | null {
  return (
    value === null ||
    (Array.isArray(value) && value.every((item) => typeof item === 'string'))
  );
}

function isNullableFiniteNumber(
  value: Json | undefined
): value is number | null {
  return (
    value === null || (typeof value === 'number' && Number.isFinite(value))
  );
}

function toPublishedClusterPost(value: Json): PublishedClusterPost | null {
  if (!isJsonObject(value)) return null;

  const {
    category,
    excerpt,
    featured_image_url: featuredImageUrl,
    keywords,
    published_at: publishedAt,
    reading_time_minutes: readingTimeMinutes,
    slug,
    tags,
    title,
  } = value;

  if (
    typeof slug !== 'string' ||
    slug.trim() === '' ||
    typeof title !== 'string' ||
    title.trim() === '' ||
    !isNullableString(excerpt) ||
    !isNullableString(category) ||
    !isNullableStringArray(tags) ||
    !isNullableStringArray(keywords) ||
    !isNullableString(featuredImageUrl) ||
    !isNullableString(publishedAt) ||
    !isNullableFiniteNumber(readingTimeMinutes)
  ) {
    return null;
  }

  return {
    category,
    excerpt,
    featured_image_url: featuredImageUrl,
    keywords,
    published_at: publishedAt,
    reading_time_minutes: readingTimeMinutes,
    slug,
    tags,
    title,
  };
}

function parseGuidePosts(value: Json | null): PublishedClusterPost[] | null {
  if (!Array.isArray(value)) return null;
  const posts = value.map(toPublishedClusterPost);
  return posts.every((post): post is PublishedClusterPost => post !== null)
    ? posts
    : null;
}

function mergeGuidePosts(
  productGuidePosts: PublishedClusterPost[],
  clusterGuidePosts: PublishedClusterPost[]
): PublishedClusterPost[] {
  const seen = new Set<string>();
  return [...productGuidePosts, ...clusterGuidePosts].filter((post) => {
    if (seen.has(post.slug)) return false;
    seen.add(post.slug);
    return true;
  });
}

function unavailableIntegrityResult(): StorefrontReadResult<never> {
  return {
    status: 'unavailable',
    error: {
      kind: 'integrity',
      operation: 'pdp_semantic_enrichment',
      retryable: false,
    },
  };
}

/**
 * Reads the entire optional PDP semantic model in one bounded database call.
 *
 * This RPC intentionally uses POST: the shared semantic classifier is bounded
 * to 8 KiB before JSON encoding, but percent-encoding it into a GET URL can
 * exceed intermediary URL limits. Optional failures are not retried here and
 * escape the cache scope so the visible PDP/LCP shell remains independent.
 */
export async function readStorefrontPdpSemanticEnrichment(
  client: SupabaseClient<StorefrontDatabase>,
  input: ReadStorefrontPdpSemanticEnrichmentInput
): Promise<StorefrontReadResult<ProductSeoLinkData>> {
  if (storefrontPdpSemanticReadCooldown.isCoolingDown(input.merchantId)) {
    return createStorefrontPdpSemanticCooldownResult();
  }

  const query = client.rpc('get_storefront_pdp_semantic_enrichment_v1', {
    p_category_slug: input.clusterRequest.p_category_slug,
    p_cluster_guide_limit: PDP_SEMANTIC_CLUSTER_GUIDE_LIMIT,
    p_cluster_rules: input.clusterRequest.p_cluster_rules,
    p_include_guides: input.includeGuides,
    p_inventory_limit: PDP_SEMANTIC_INVENTORY_LIMIT,
    p_merchant_id: input.merchantId,
    p_product_guide_limit: PDP_SEMANTIC_PRODUCT_GUIDE_LIMIT,
    p_product_id: input.productId,
    p_search_query: input.clusterRequest.p_search_query,
  });
  const { response, trace } = await runStorefrontPdpSemanticRpcWithCooldown(
    query,
    {
      deadlineMs: PDP_SEMANTIC_ENRICHMENT_TOTAL_DEADLINE_MS,
      traceThresholdMs: PDP_SEMANTIC_ENRICHMENT_TRACE_THRESHOLD_MS,
    },
    input.merchantId
  );

  const result = resolveStorefrontReadResult({
    operation: 'pdp_semantic_enrichment',
    response,
    parse: (rows) => (Array.isArray(rows) ? (rows[0] ?? null) : null),
  });

  if (result.status === 'unavailable' && result.error.kind === 'timeout') {
    trace({
      errorCode: result.error.code,
      outcome: 'timeout_response',
      responseStatus: result.error.httpStatus,
    });
  }

  if (result.status === 'unavailable') {
    if (result.error.retryable) {
      storefrontPdpSemanticReadCooldown.markFailure(input.merchantId);
    } else {
      storefrontPdpSemanticReadCooldown.clear(input.merchantId);
    }
    return result;
  }
  storefrontPdpSemanticReadCooldown.clear(input.merchantId);
  if (result.status === 'not_found') return unavailableIntegrityResult();

  const row = result.value;
  if (row.resolution_status === 'not_found') return { status: 'not_found' };
  if (row.resolution_status !== 'found') return unavailableIntegrityResult();

  const inventory = parseInventory(
    row.inventory_data,
    input.clusterRequest.p_category_slug
  );
  const clusterGuidePosts = parseGuidePosts(row.cluster_guide_data);
  const productGuidePosts = parseGuidePosts(row.product_guide_data);
  if (!inventory || !clusterGuidePosts || !productGuidePosts) {
    return unavailableIntegrityResult();
  }

  return {
    status: 'found',
    value: {
      guidePosts: mergeGuidePosts(productGuidePosts, clusterGuidePosts),
      inventory,
      priorityGuidePostSlugs: productGuidePosts.map((post) => post.slug),
    },
  };
}
