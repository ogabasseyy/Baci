import type {
  BuildCommercialGuideLinksContext,
  SupportedClusterCategory,
} from '@/lib/storefront-content/content-cluster-types';

interface BuildCompareGuideContextsInput {
  supportedClusterCategory: SupportedClusterCategory | null;
  leftBrand: string | null | undefined;
  rightBrand: string | null | undefined;
  leftName: string;
  rightName: string;
  leftLoadSlug: string;
  rightLoadSlug: string;
  leftBuildSlug: string;
  rightBuildSlug: string;
}

interface CompareGuideContexts {
  guideLoadContext: BuildCommercialGuideLinksContext | null;
  guideBuildContext: BuildCommercialGuideLinksContext | null;
}

/** Builds the raw-load and resolved-build contexts used by compare guide links. */
export function buildCompareGuideContexts(
  input: BuildCompareGuideContextsInput
): CompareGuideContexts {
  if (!input.supportedClusterCategory) {
    return { guideLoadContext: null, guideBuildContext: null };
  }

  const guideBrands = [input.leftBrand, input.rightBrand].filter(
    (brand): brand is string => Boolean(brand)
  );
  const productNames = [input.leftName, input.rightName];
  const productBrands = [input.leftBrand ?? null, input.rightBrand ?? null];

  return {
    guideLoadContext: {
      pageKind: 'compare',
      categorySlug: input.supportedClusterCategory,
      brands: guideBrands,
      productBrands,
      productNames,
      productSlugs: [input.leftLoadSlug, input.rightLoadSlug],
    },
    guideBuildContext: {
      pageKind: 'compare',
      categorySlug: input.supportedClusterCategory,
      brands: guideBrands,
      productBrands,
      productNames,
      productSlugs: [input.leftBuildSlug, input.rightBuildSlug],
    },
  };
}
