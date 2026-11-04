import { CONTENT_CLUSTER_SUPPORT } from '@/config/storefront-content-clusters';
import { generateSlug } from '@/lib/seo-utils';
import { buildCommercialGuideLinks } from '@/lib/storefront-content/build-commercial-guide-links';
import type {
  ContentClusterKind,
  InformationalGuideLink,
  PublishedClusterPost,
  SupportedClusterCategory,
} from '@/lib/storefront-content/content-cluster-types';
import { evaluateV2GuideCandidate } from '@/lib/storefront-content/evaluate-v2-guide-candidate';
import { getContextBrandKeys } from '@/lib/storefront-content/get-context-brand-keys';
import { getPostTokenGroups } from '@/lib/storefront-content/get-post-token-groups';
import { inferContentClusterContext } from '@/lib/storefront-content/infer-content-cluster-context';
import type { BuildProductSemanticModelInput } from './product-semantic-types';

function dedupeGuideLinks(links: InformationalGuideLink[]) {
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
  const brandAliases = CONTENT_CLUSTER_SUPPORT[categorySlug]?.brandTokens ?? {};
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

function hasV2Metadata(post: PublishedClusterPost): boolean {
  return Boolean(
    post.guide_scope ||
      post.metadata_status ||
      post.cluster_category_id ||
      post.cluster_category_slug ||
      post.subjects?.length ||
      post.eligibility_reason
  );
}

const VALID_CONTENT_CLUSTER_KINDS: readonly ContentClusterKind[] = [
  'buyer-guide',
  'best-in-nigeria',
  'troubleshooting',
  'decision-support',
];

function isContentClusterKind(value: unknown): value is ContentClusterKind {
  return (
    typeof value === 'string' &&
    (VALID_CONTENT_CLUSTER_KINDS as readonly string[]).includes(value)
  );
}

function convertV2PostToLink(
  post: PublishedClusterPost,
  storeUrl: string
): InformationalGuideLink | null {
  const kind = post.guide_kind;
  if (!isContentClusterKind(kind)) return null;
  const baseUrl = storeUrl.replace(/\/+$/, '');
  const description = post.reading_time_minutes
    ? `${post.reading_time_minutes} minute guide`
    : post.excerpt || 'Guide';

  return {
    href: `${baseUrl}/blog/${post.slug}`,
    title: post.title,
    description,
    kind,
  };
}

export function buildProductGuideLinks(
  input: BuildProductSemanticModelInput
): InformationalGuideLink[] {
  const posts = input.guidePosts ?? [];
  const anyHasV2 = posts.some(hasV2Metadata);
  const hasSupportedLegacyCluster =
    input.categorySlug in CONTENT_CLUSTER_SUPPORT;

  if (!anyHasV2 && !hasSupportedLegacyCluster) {
    return [];
  }

  const categorySlug = input.categorySlug as SupportedClusterCategory;
  const priorityGuidePostSlugs = new Set(input.priorityGuidePostSlugs ?? []);

  const v2Context = {
    productId: input.currentProduct.id,
    categorySlug: input.categorySlug,
    categoryId: input.currentProduct.category_id,
    brandKey: input.currentProduct.brand,
    validCategorySlugs: input.currentProduct.category_slugs ?? undefined,
  };

  const eligibleV2Links: Array<{ slug: string; link: InformationalGuideLink }> =
    [];
  const eligibleLegacyPosts: PublishedClusterPost[] = [];

  for (const post of posts) {
    if (hasV2Metadata(post)) {
      const evalResult = evaluateV2GuideCandidate(post, v2Context);
      if (evalResult.eligible) {
        const link = convertV2PostToLink(post, input.storeUrl);
        if (link) {
          eligibleV2Links.push({ slug: post.slug, link });
        }
      }
    } else {
      if (
        post.merchant_intent === 'news' &&
        (post.merchant_intent_source === 'merchant_declared' ||
          post.merchant_intent_source === 'verified_receipt' ||
          post.merchant_intent_source === 'reviewed')
      ) {
        continue;
      }
      if (
        hasSupportedLegacyCluster &&
        !hasConfiguredPostBrandMismatch(
          post,
          categorySlug,
          input.currentProduct.brand,
          input.currentProduct.name
        )
      ) {
        eligibleLegacyPosts.push(post);
      }
    }
  }

  // Handle legacy posts via buildCommercialGuideLinks if any
  let legacyPriorityLinks: InformationalGuideLink[] = [];
  let legacyFallbackLinks: InformationalGuideLink[] = [];

  if (hasSupportedLegacyCluster && eligibleLegacyPosts.length > 0) {
    const legacyPriorityPosts = eligibleLegacyPosts.filter((p) =>
      priorityGuidePostSlugs.has(p.slug)
    );
    const legacyFallbackPosts = eligibleLegacyPosts.filter(
      (p) => !priorityGuidePostSlugs.has(p.slug)
    );

    const context = {
      pageKind: 'product' as const,
      categorySlug,
      brands: input.currentProduct.brand ? [input.currentProduct.brand] : [],
      productNames: [input.currentProduct.name],
      productSlugs: [input.currentProduct.slug],
    };

    legacyPriorityLinks = buildCommercialGuideLinks({
      storeUrl: input.storeUrl,
      posts: legacyPriorityPosts,
      context,
    });
    legacyFallbackLinks = buildCommercialGuideLinks({
      storeUrl: input.storeUrl,
      posts: legacyFallbackPosts,
      context,
    });
  }

  // Combine V2 and Legacy, keeping priority slugs first (priority is ranking only, never permission)
  const v2PriorityLinks = eligibleV2Links
    .filter((item) => priorityGuidePostSlugs.has(item.slug))
    .map((i) => i.link);
  const v2FallbackLinks = eligibleV2Links
    .filter((item) => !priorityGuidePostSlugs.has(item.slug))
    .map((i) => i.link);

  const combinedPriority = [...v2PriorityLinks, ...legacyPriorityLinks];
  const combinedFallback = [...v2FallbackLinks, ...legacyFallbackLinks];

  return dedupeGuideLinks([...combinedPriority, ...combinedFallback]).slice(
    0,
    3
  );
}
