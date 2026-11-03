import { CONTENT_CLUSTER_SUPPORT } from '@/config/storefront-content-clusters';
import { generateSlug } from '@/lib/seo-utils';
import { buildCommercialGuideLinks } from '@/lib/storefront-content/build-commercial-guide-links';
import type {
  PublishedClusterPost,
  SupportedClusterCategory,
} from '@/lib/storefront-content/content-cluster-types';
import { getContextBrandKeys } from '@/lib/storefront-content/get-context-brand-keys';
import { getPostTokenGroups } from '@/lib/storefront-content/get-post-token-groups';
import { inferContentClusterContext } from '@/lib/storefront-content/infer-content-cluster-context';
import type { BuildProductSemanticModelInput } from './product-semantic-types';

const GAME_CATEGORY_PATTERN =
  /^(?:gaming(?:-accessories)?|portable-gaming|playstation-[45]|nintendo-switch(?:-2)?|xbox)$/u;

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

function hasConfiguredPostBrandMismatch(
  post: PublishedClusterPost,
  categorySlug: SupportedClusterCategory,
  productBrand: string | null | undefined,
  productName: string
): boolean {
  if (GAME_CATEGORY_PATTERN.test(categorySlug)) {
    return false;
  }

  const brandAliases = CONTENT_CLUSTER_SUPPORT[categorySlug].brandTokens;
  const productBrands = productBrand ? [productBrand] : [];
  const normalizedBrands = getContextBrandKeys(
    productBrands,
    [productName],
    brandAliases
  );
  const configuredProductBrands = normalizedBrands.filter(
    (brand) => brand in brandAliases
  );

  if (configuredProductBrands.length === 0) {
    return false;
  }

  const inferred = inferContentClusterContext(post);
  const configuredPostBrands = inferred.brands.filter(
    (brand) => generateSlug(brand) in brandAliases
  );

  if (configuredPostBrands.length === 0) {
    return false;
  }

  const hasBrandMatch =
    inferred.brands.some((brand) =>
      normalizedBrands.includes(generateSlug(brand))
    ) ||
    normalizedBrands.some((brand) => {
      const brandTokens = brand.split('-').filter(Boolean);
      return (
        brandTokens.length > 0 &&
        getPostTokenGroups(post).some((tokens) =>
          tokens.some((_, idx) =>
            brandTokens.every((token, offset) => tokens[idx + offset] === token)
          )
        )
      );
    });

  return !hasBrandMatch;
}

export function buildProductGuideLinks(input: BuildProductSemanticModelInput) {
  if (!(input.categorySlug in CONTENT_CLUSTER_SUPPORT)) {
    return [];
  }

  const categorySlug = input.categorySlug as SupportedClusterCategory;

  const priorityGuidePostSlugs = new Set(input.priorityGuidePostSlugs ?? []);

  const validGuidePosts = (input.guidePosts ?? []).filter((post) => {
    if (
      post.merchant_intent === 'news' &&
      (post.merchant_intent_source === 'merchant_declared' ||
        post.merchant_intent_source === 'verified_receipt' ||
        post.merchant_intent_source === 'reviewed')
    ) {
      return false;
    }

    return true;
  });

  const priorityGuidePosts = validGuidePosts.filter(
    (post) =>
      priorityGuidePostSlugs.has(post.slug) &&
      !hasConfiguredPostBrandMismatch(
        post,
        categorySlug,
        input.currentProduct.brand,
        input.currentProduct.name
      )
  );
  const fallbackGuidePosts = validGuidePosts.filter(
    (post) => !priorityGuidePostSlugs.has(post.slug)
  );

  const context = {
    pageKind: 'product' as const,
    categorySlug,
    brands: input.currentProduct.brand ? [input.currentProduct.brand] : [],
    productNames: [input.currentProduct.name],
    productSlugs: [input.currentProduct.slug],
  };

  const priorityLinks = buildCommercialGuideLinks({
    storeUrl: input.storeUrl,
    posts: priorityGuidePosts,
    context,
  });
  const fallbackLinks = buildCommercialGuideLinks({
    storeUrl: input.storeUrl,
    posts: fallbackGuidePosts,
    context,
  });

  return dedupeGuideLinks([...priorityLinks, ...fallbackLinks]).slice(0, 3);
}
