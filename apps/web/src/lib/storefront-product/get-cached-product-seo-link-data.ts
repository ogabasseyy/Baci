import { getPublishedClusterPosts } from '@/lib/storefront-content/get-published-cluster-posts';
import { isPublishedClusterPost } from '@/lib/storefront-content/is-published-cluster-post';
import { isSupportedClusterCategory } from '@/lib/storefront-content/storefront-cluster-guide-request';
import { getCachedPdpProductGuidePosts } from './get-cached-pdp-product-guide-posts';
import {
  getCachedPdpSemanticInventory,
  PDP_SEMANTIC_TOTAL_TIMEOUT_MS,
} from './get-cached-pdp-semantic-inventory';
import { runStorefrontPdpSemanticRpcWithCooldown } from './run-storefront-pdp-semantic-rpc-with-cooldown';
import type { ProductSeoLinkData } from './storefront-pdp-semantic-enrichment';

export type { ProductSeoLinkData };

export interface ProductSeoLinkDataInput {
  blogEnabled: boolean;
  categorySlug: string;
  merchantId: string;
  productBrand: string | null | undefined;
  productId: string;
  productName: string;
  productSlug: string;
  storeSlug: string;
}

// This function deliberately owns no cache directive. Its three bounded reads
// have different reuse keys and freshness windows: category inventory is shared
// by every PDP in a category, cluster guides are shared by their context, and
// product-linked guides are keyed by product. Keeping orchestration uncached
// means a partial guide failure cannot be persisted as a complete empty model.
export async function getCachedProductSeoLinkData(
  input: ProductSeoLinkDataInput
): Promise<ProductSeoLinkData> {
  const {
    blogEnabled,
    categorySlug,
    merchantId,
    productBrand,
    productId,
    productName,
    productSlug,
  } = input;
  // Inventory is the only required leg. Do not fan out two more Supabase
  // reads while it is already timing out; once it succeeds, the optional guide
  // legs run in parallel and can fail open independently.
  const inventoryScope = `${merchantId}:${categorySlug}`;
  const { response: inventory } = await runStorefrontPdpSemanticRpcWithCooldown(
    () => getCachedPdpSemanticInventory(merchantId, categorySlug),
    {
      deadlineMs: PDP_SEMANTIC_TOTAL_TIMEOUT_MS,
      traceThresholdMs: 1_000,
    },
    inventoryScope,
    () => []
  );

  if (!blogEnabled) {
    return {
      guidePosts: [],
      inventory,
      priorityGuidePostSlugs: [],
    };
  }

  const clusterGuidePromise = isSupportedClusterCategory(categorySlug)
    ? getPublishedClusterPosts(merchantId, {
        brands: productBrand ? [productBrand] : [],
        categorySlug,
        pageKind: 'product',
        productNames: productName ? [productName] : [],
        productSlugs: productSlug ? [productSlug] : [],
      })
        .then((posts) => posts.filter(isPublishedClusterPost))
        .catch((error: unknown) => {
          console.warn('Failed to load PDP cluster guide posts', {
            categorySlug,
            error,
            merchantId,
          });
          return [];
        })
    : Promise.resolve([]);
  const productGuidePromise = getCachedPdpProductGuidePosts(
    merchantId,
    productId
  ).catch((error: unknown) => {
    console.warn('Failed to load PDP product guide posts', {
      error,
      merchantId,
      productId,
    });
    return [];
  });

  const [clusterGuidePosts, productGuidePosts] = await Promise.all([
    clusterGuidePromise,
    productGuidePromise,
  ]);
  const guidePosts = mergeGuidePosts(productGuidePosts, clusterGuidePosts);

  return {
    guidePosts,
    inventory,
    priorityGuidePostSlugs: productGuidePosts.map((post) => post.slug),
  };
}

function mergeGuidePosts(
  productGuidePosts: ProductSeoLinkData['guidePosts'],
  clusterGuidePosts: ProductSeoLinkData['guidePosts']
): ProductSeoLinkData['guidePosts'] {
  const seen = new Set<string>();
  return [...productGuidePosts, ...clusterGuidePosts].filter((post) => {
    if (seen.has(post.slug)) return false;
    seen.add(post.slug);
    return true;
  });
}
