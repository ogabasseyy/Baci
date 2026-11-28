import type {
  BuildCommercialGuideLinksContext,
  PublishedClusterPost,
} from './content-cluster-types';
import { getCachedClusterGuideCandidates } from './get-cached-cluster-guide-candidates';
import { buildStorefrontClusterGuideRequest } from './storefront-cluster-guide-request';

export async function getPublishedClusterPosts(
  merchantId: string,
  context: BuildCommercialGuideLinksContext
): Promise<PublishedClusterPost[]> {
  const { p_category_slug, p_search_query } =
    buildStorefrontClusterGuideRequest(context);
  return await getCachedClusterGuideCandidates(
    merchantId,
    p_category_slug,
    p_search_query
  );
}
