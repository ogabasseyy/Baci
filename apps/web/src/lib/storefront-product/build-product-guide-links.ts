import {
  CONTENT_CLUSTER_SCORE,
  CONTENT_CLUSTER_SUPPORT,
} from '@/config/storefront-content-clusters';
import { buildCommercialGuideLinks } from '@/lib/storefront-content/build-commercial-guide-links';
import type { SupportedClusterCategory } from '@/lib/storefront-content/content-cluster-types';
import type { BuildProductSemanticModelInput } from './product-semantic-types';

function dedupeGuideLinks(links: ReturnType<typeof buildCommercialGuideLinks>) {
  const seen = new Set<string>();

  return links.filter((link) => {
    if (seen.has(link.href)) {
      return false;
    }

    seen.add(link.href);
    return true;
  });
}

export function buildProductGuideLinks(input: BuildProductSemanticModelInput) {
  if (!(input.categorySlug in CONTENT_CLUSTER_SUPPORT)) {
    return [];
  }

  const guidePosts = (input.guidePosts ?? []).filter(
    (post) =>
      !(
        post.merchant_intent === 'news' &&
        (post.merchant_intent_source === 'merchant_declared' ||
          post.merchant_intent_source === 'verified_receipt' ||
          post.merchant_intent_source === 'reviewed')
      )
  );
  const priorityGuidePostSlugs = new Set(input.priorityGuidePostSlugs ?? []);
  const priorityGuidePosts = guidePosts.filter((post) =>
    priorityGuidePostSlugs.has(post.slug)
  );
  const fallbackGuidePosts = guidePosts.filter(
    (post) => !priorityGuidePostSlugs.has(post.slug)
  );

  const context = {
    pageKind: 'product' as const,
    categorySlug: input.categorySlug as SupportedClusterCategory,
    brands: input.currentProduct.brand ? [input.currentProduct.brand] : [],
    productNames: [input.currentProduct.name],
    productSlugs: [input.currentProduct.slug],
  };

  const priorityMinScore =
    CONTENT_CLUSTER_SCORE.categoryMatch + CONTENT_CLUSTER_SCORE.brandMatch;

  return dedupeGuideLinks([
    ...buildCommercialGuideLinks({
      storeUrl: input.storeUrl,
      posts: priorityGuidePosts,
      context,
      minScore: priorityMinScore,
    }),
    ...buildCommercialGuideLinks({
      storeUrl: input.storeUrl,
      posts: fallbackGuidePosts,
      context,
    }),
  ]).slice(0, 3);
}
