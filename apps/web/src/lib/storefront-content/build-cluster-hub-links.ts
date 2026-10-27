import { generateSlug } from '@/lib/seo-utils';
import { brandAuthorityTaxonomy } from '@/lib/storefront-category/brand-authority-taxonomy';
import type { ModelFamilyAuthorityEntry } from '@/lib/storefront-category/category-hub-types';
import { modelFamilyAuthorityTaxonomy } from '@/lib/storefront-category/model-family-authority-taxonomy';
import { buildAuthorityHubCandidates } from './authority-hub-candidates';
import type { PublishedClusterPost } from './content-cluster-types';
import type {
  EligibleHubProductInput,
  ResolvedEligibleCategoryHubDestinations,
} from './eligible-hub-destinations';
import { resolveEligibleCategoryHubDestinations } from './eligible-hub-destinations';
import { verifyEligibleHubsAgainstDestination } from './verify-eligible-hubs-against-destination';

export interface ClusterHubLink {
  href: string;
  label: string;
}

function postMatchesModelFamily(
  post: PublishedClusterPost,
  familyEntry: ModelFamilyAuthorityEntry
): boolean {
  // Match against the combined post context: a bare model token in the
  // title ("A55 vs A35") may only be attributable when the brand is named
  // in tags/keywords, so brand-bearing fields lead. The matcher's
  // sentence-level rival-brand safeguards still apply to the combined text.
  const combinedContext = [
    ...(post.tags ?? []),
    ...(post.keywords ?? []),
    post.title,
    post.slug.replace(/[-_]/g, ' '),
    post.excerpt ?? '',
  ].join(' ');
  return modelFamilyAuthorityTaxonomy.matchesContent(
    familyEntry,
    combinedContext
  );
}

function findHubForBrand(
  hubs: ResolvedEligibleCategoryHubDestinations['brandHubs'],
  categorySlug: string,
  inferredBrand: string
) {
  return hubs.find((hub) => {
    if (generateSlug(hub.brand_key ?? '') === generateSlug(inferredBrand)) {
      return true;
    }
    const entry = brandAuthorityTaxonomy.getEntry(
      categorySlug,
      hub.brand_key ?? ''
    );
    return entry
      ? brandAuthorityTaxonomy.matchesBrand(entry, inferredBrand)
      : false;
  });
}

export async function buildClusterHubLinks(args: {
  post: PublishedClusterPost;
  inferredBrands: string[];
  categorySlug: string;
  categoryName: string;
  storeUrl: string;
  merchantId: string;
  products: EligibleHubProductInput[];
  /** Override pools are caller-authoritative test seams; live pools are verified. */
  skipDestinationVerification?: boolean;
}): Promise<{
  brandHubLinks: ClusterHubLink[];
  familyHubLinks: ClusterHubLink[];
}> {
  const brandHubLinks: ClusterHubLink[] = [];
  const familyHubLinks: ClusterHubLink[] = [];
  if (args.inferredBrands.length === 0) {
    return { brandHubLinks, familyHubLinks };
  }

  const resolvedHubs = args.skipDestinationVerification
    ? resolveEligibleCategoryHubDestinations({
        storeUrl: args.storeUrl,
        categorySlug: args.categorySlug,
        products: args.products,
        // No assumeCategoryScoped: the destination counts only exact
        // category membership, so the trusted seam exact-filters the
        // override pool on category_slug/category/category_slugs too.
      })
    : buildAuthorityHubCandidates(
        args.categorySlug,
        args.inferredBrands,
        args.storeUrl
      );

  // Only brands the article actually matches can emit links, so only those
  // hubs need destination verification (family hubs follow their parent).
  const matchedBrandKeys = new Set<string>();
  for (const inferredBrand of args.inferredBrands) {
    const hub = findHubForBrand(
      resolvedHubs.brandHubs,
      args.categorySlug,
      inferredBrand
    );
    if (hub?.brand_key) {
      matchedBrandKeys.add(hub.brand_key);
    }
  }

  const eligibleHubs = args.skipDestinationVerification
    ? resolvedHubs
    : await verifyEligibleHubsAgainstDestination({
        merchantId: args.merchantId,
        categorySlug: args.categorySlug,
        hubs: {
          brandHubs: resolvedHubs.brandHubs.filter(
            (hub) => hub.brand_key && matchedBrandKeys.has(hub.brand_key)
          ),
          familyHubs: resolvedHubs.familyHubs.filter(
            (hub) => hub.brand_key && matchedBrandKeys.has(hub.brand_key)
          ),
        },
      });

  const pushedBrandKeys = new Set<string>();
  for (const inferredBrand of args.inferredBrands) {
    const matchingBrandHub = findHubForBrand(
      eligibleHubs.brandHubs,
      args.categorySlug,
      inferredBrand
    );
    if (!matchingBrandHub) continue;
    // Aliased inferred brands (redmi + xiaomi) resolve to the same hub.
    if (
      matchingBrandHub.brand_key &&
      pushedBrandKeys.has(matchingBrandHub.brand_key)
    ) {
      continue;
    }
    if (matchingBrandHub.brand_key) {
      pushedBrandKeys.add(matchingBrandHub.brand_key);
    }
    if (matchingBrandHub.brand_key) {
      matchedBrandKeys.add(matchingBrandHub.brand_key);
    }
    const entry = brandAuthorityTaxonomy.getEntry(
      args.categorySlug,
      matchingBrandHub.brand_key ?? ''
    );
    const displayName = entry?.displayName ?? inferredBrand;
    brandHubLinks.push({
      href: matchingBrandHub.href,
      label: `Explore ${displayName} ${args.categoryName.toLowerCase()}`,
    });
  }

  for (const familyHub of eligibleHubs.familyHubs) {
    if (!familyHub.brand_key || !matchedBrandKeys.has(familyHub.brand_key)) {
      continue;
    }
    const familyEntry = modelFamilyAuthorityTaxonomy.getEntry(
      args.categorySlug,
      familyHub.brand_key,
      familyHub.family_key ?? ''
    );
    if (familyEntry && postMatchesModelFamily(args.post, familyEntry)) {
      familyHubLinks.push({
        href: familyHub.href,
        label: `Explore ${familyEntry.displayName}`,
      });
    }
  }

  return { brandHubLinks, familyHubLinks };
}
