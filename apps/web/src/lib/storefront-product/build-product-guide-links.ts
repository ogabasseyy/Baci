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
      post.guide_kind ||
      (post.metadata_status && post.metadata_status !== 'unverified') ||
      post.cluster_category_id ||
      post.cluster_category_slug ||
      post.applicable_brands?.length ||
      post.metadata_source_revision ||
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

interface EligibleV2LinkItem {
  slug: string;
  link: InformationalGuideLink;
  matchPriority: number;
  originalIndex: number;
}

export function buildProductGuideLinks(
  input: BuildProductSemanticModelInput
): InformationalGuideLink[] {
  const posts = (input.guidePosts ?? []).filter(
    (p) =>
      !(
        p.merchant_intent === 'news' &&
        (p.merchant_intent_source === 'merchant_declared' ||
          p.merchant_intent_source === 'verified_receipt' ||
          p.merchant_intent_source === 'reviewed')
      )
  );
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

  const eligibleItems: EligibleV2LinkItem[] = [];

  for (let i = 0; i < posts.length; i++) {
    const post = posts[i];
    if (hasV2Metadata(post)) {
      const evalResult = evaluateV2GuideCandidate(post, v2Context);
      if (evalResult.eligible) {
        const link = convertV2PostToLink(post, input.storeUrl);
        if (link) {
          let matchPriority = 3;
          if (evalResult.reason?.startsWith('subject_')) {
            matchPriority = 1;
          } else if (evalResult.reason === 'brand_family_guide') {
            matchPriority = 2;
          }
          eligibleItems.push({
            slug: post.slug,
            link,
            matchPriority,
            originalIndex: i,
          });
        }
      }
    }
  }

  if (hasSupportedLegacyCluster) {
    const legacyPosts = posts.filter((p) => !hasV2Metadata(p));
    const legacyPriorityPosts = legacyPosts.filter(
      (p) =>
        priorityGuidePostSlugs.has(p.slug) &&
        !hasConfiguredPostBrandMismatch(
          p,
          categorySlug,
          input.currentProduct.brand,
          input.currentProduct.name
        )
    );
    const legacyFallbackPosts = legacyPosts.filter(
      (p) => !priorityGuidePostSlugs.has(p.slug)
    );

    const context = {
      pageKind: 'product' as const,
      categorySlug,
      brands: input.currentProduct.brand ? [input.currentProduct.brand] : [],
      productNames: [input.currentProduct.name],
      productSlugs: [input.currentProduct.slug],
    };

    if (legacyPriorityPosts.length > 0) {
      const priorityLinks = buildCommercialGuideLinks({
        storeUrl: input.storeUrl,
        posts: legacyPriorityPosts,
        context,
      });
      for (let i = 0; i < priorityLinks.length; i++) {
        const link = priorityLinks[i];
        const slug = link.href.split('/').pop() ?? '';
        eligibleItems.push({
          slug,
          link,
          matchPriority: 1,
          originalIndex: i,
        });
      }
    }

    if (legacyFallbackPosts.length > 0) {
      const fallbackLinks = buildCommercialGuideLinks({
        storeUrl: input.storeUrl,
        posts: legacyFallbackPosts,
        context,
      });
      for (let i = 0; i < fallbackLinks.length; i++) {
        const link = fallbackLinks[i];
        const slug = link.href.split('/').pop() ?? '';
        eligibleItems.push({
          slug,
          link,
          matchPriority: 4,
          originalIndex: i,
        });
      }
    }
  }

  eligibleItems.sort((a, b) => {
    const aPriority = priorityGuidePostSlugs.has(a.slug) ? 0 : 1;
    const bPriority = priorityGuidePostSlugs.has(b.slug) ? 0 : 1;
    if (aPriority !== bPriority) {
      return aPriority - bPriority;
    }
    if (a.matchPriority !== b.matchPriority) {
      return a.matchPriority - b.matchPriority;
    }
    return a.originalIndex - b.originalIndex;
  });

  return dedupeGuideLinks(eligibleItems.map((i) => i.link)).slice(0, 3);
}
