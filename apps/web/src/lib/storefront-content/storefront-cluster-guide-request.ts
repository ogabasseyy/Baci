import { CONTENT_CLUSTER_SUPPORT } from '@/config/storefront-content-clusters';
import type { Json } from '@/types/supabase';
import { buildClusterGuideSearchQuery } from './build-cluster-guide-search-query';
import type {
  BuildCommercialGuideLinksContext,
  SupportedClusterCategory,
} from './content-cluster-types';

export interface StorefrontClusterRule {
  [key: string]: Json;
  article_tokens: string[];
  category_names: string[];
  category_slug: string;
  rule_order: number;
}

export interface StorefrontClusterGuideRequest {
  p_category_slug: string;
  p_cluster_rules: StorefrontClusterRule[];
  p_search_query: string;
}

type StorefrontClusterGuideContext = Omit<
  BuildCommercialGuideLinksContext,
  'categorySlug'
> & { categorySlug: string };

const STOREFRONT_CLUSTER_RULES: StorefrontClusterRule[] = Object.entries(
  CONTENT_CLUSTER_SUPPORT
).map(([categorySlug, support], ruleOrder) => ({
  article_tokens: [...support.articleTokens],
  category_names: [...support.categoryNames],
  category_slug: categorySlug,
  rule_order: ruleOrder,
}));

export function isSupportedClusterCategory(
  categorySlug: string
): categorySlug is SupportedClusterCategory {
  return Object.hasOwn(CONTENT_CLUSTER_SUPPORT, categorySlug);
}

/**
 * Builds the shared, bounded classifier payload consumed by public guide RPCs.
 * Unsupported categories deliberately produce an empty classifier so the
 * database fails closed instead of broad-scanning the merchant blog corpus.
 */
export function buildStorefrontClusterGuideRequest(
  context: StorefrontClusterGuideContext
): StorefrontClusterGuideRequest {
  const categorySlug = context.categorySlug.trim().toLowerCase();
  if (!isSupportedClusterCategory(categorySlug)) {
    return {
      p_category_slug: categorySlug,
      p_cluster_rules: [],
      p_search_query: '',
    };
  }

  return {
    p_category_slug: categorySlug,
    p_cluster_rules: STOREFRONT_CLUSTER_RULES,
    p_search_query: buildClusterGuideSearchQuery({
      ...context,
      categorySlug,
    }),
  };
}
