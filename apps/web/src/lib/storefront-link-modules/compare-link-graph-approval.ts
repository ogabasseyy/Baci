import {
  buildCuratedCompareSlugSet,
  isCuratedCompareSlug,
} from '@/lib/storefront-compare/compare-indexability-policy';

interface CompareGraphApprovalProduct {
  slug: string;
  name: string;
  brand?: string | null;
  price: number;
  category_slug?: string | null;
  product_key_specs?: Record<string, unknown> | null;
}

interface CompareGraphApprovalCandidate {
  comparisonSlug: string;
  productSlugs: [string, string];
}

interface SelectApprovedCompareGraphEntriesInput<
  TEntry extends CompareGraphApprovalCandidate,
> {
  storeUrl: string;
  categorySlug: string;
  categoryName: string;
  policyProducts: CompareGraphApprovalProduct[];
  candidateEntries: TEntry[];
  candidateEntriesAreIndexable?: boolean;
  requiredProductSlugs?: string[];
  maxLinks: number;
}

const COMPARE_GRAPH_SUPPLEMENTAL_APPROVAL_CANDIDATE_LIMIT = 150;

export function getSupplementalApprovalCandidateLimit(maxLinks: number) {
  return Math.min(
    COMPARE_GRAPH_SUPPLEMENTAL_APPROVAL_CANDIDATE_LIMIT,
    Math.max(16, maxLinks * 4)
  );
}

export function selectApprovedCompareGraphEntries<
  TEntry extends CompareGraphApprovalCandidate,
>({
  storeUrl,
  categorySlug,
  categoryName,
  policyProducts,
  candidateEntries,
  candidateEntriesAreIndexable = false,
  requiredProductSlugs,
  maxLinks,
}: SelectApprovedCompareGraphEntriesInput<TEntry>) {
  if (maxLinks <= 0) {
    return [];
  }

  const approvedEntries: TEntry[] = [];
  const supplementalApprovalCandidateLimit =
    getSupplementalApprovalCandidateLimit(maxLinks);
  let curatedCompareSlugs: Set<string> | undefined;
  const supplementalCuratedCompareSlugsByComparisonSlug = new Map<
    string,
    Set<string>
  >();

  const isApprovedEntry = (entry: TEntry, index: number) => {
    // buildCompareLinkGraph only passes candidates that already satisfied the
    // product-pair indexability policy. Rebuilding the full discovery graph for
    // each of those candidates is redundant: putting the candidate's two
    // products first in the supplemental window necessarily emits that same
    // pair. Avoid turning the bounded category graph into nested graph builds.
    if (
      candidateEntriesAreIndexable &&
      index < supplementalApprovalCandidateLimit
    ) {
      return true;
    }

    curatedCompareSlugs ??= buildCuratedCompareSlugSet({
      storeUrl,
      categorySlug,
      categoryName,
      requiredProductSlugs,
      products: policyProducts,
    });

    if (isCuratedCompareSlug(entry.comparisonSlug, curatedCompareSlugs)) {
      return true;
    }

    if (index >= supplementalApprovalCandidateLimit) {
      return false;
    }

    const supplementalCuratedCompareSlugs =
      supplementalCuratedCompareSlugsByComparisonSlug.get(
        entry.comparisonSlug
      ) ??
      buildCuratedCompareSlugSet({
        storeUrl,
        categorySlug,
        categoryName,
        requiredProductSlugs: entry.productSlugs,
        products: policyProducts,
      });

    supplementalCuratedCompareSlugsByComparisonSlug.set(
      entry.comparisonSlug,
      supplementalCuratedCompareSlugs
    );

    return isCuratedCompareSlug(
      entry.comparisonSlug,
      supplementalCuratedCompareSlugs
    );
  };

  for (const [index, entry] of candidateEntries.entries()) {
    if (approvedEntries.length >= maxLinks) {
      break;
    }

    if (!isApprovedEntry(entry, index)) {
      continue;
    }

    approvedEntries.push(entry);
  }

  return approvedEntries;
}
