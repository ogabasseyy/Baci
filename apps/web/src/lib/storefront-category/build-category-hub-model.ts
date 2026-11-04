import { CONTENT_CLUSTER_SUPPORT } from '@/config/storefront-content-clusters';
import { buildCategoryHubCards } from '@/lib/storefront-category/category-hub-cards';
import { resolveCategoryHubContent } from '@/lib/storefront-category/category-hub-content';
import type {
  BuildCategoryHubModelInput,
  CategoryHubModel,
} from '@/lib/storefront-category/category-hub-types';
import { buildCategorySupportLinks } from '@/lib/storefront-compare/build-commercial-support-links';
import { buildCommercialGuideLinks } from '@/lib/storefront-content/build-commercial-guide-links';
import type { SupportedClusterCategory } from '@/lib/storefront-content/content-cluster-types';

export function buildCategoryHubModel(
  input: BuildCategoryHubModelInput
): CategoryHubModel {
  if (input.isCollection) {
    const collectionSeo = input.collectionSeo ?? {};
    return {
      intro: {
        heading: collectionSeo.heading ?? input.categoryName,
        description: collectionSeo.description ?? '',
        source: 'merchant',
      },
      trustFeatures: collectionSeo.features ?? [],
      bestForCards: [],
      brandCards: [],
      priceBandCards: [],
      comparisonLinks: [],
      guideLinks: [],
      faqItems: collectionSeo.faqs ?? [],
    };
  }

  const { intro, trustFeatures, faqItems } = resolveCategoryHubContent({
    categorySlug: input.categorySlug,
    categoryName: input.categoryName,
    merchantBusinessName: input.merchantBusinessName,
    categorySeo: input.categorySeo,
    products: input.products,
  });
  const { bestForCards, brandCards, priceBandCards } = buildCategoryHubCards({
    categorySlug: input.categorySlug,
    storeUrl: input.storeUrl,
    products: input.products,
    priceBandProducts: input.priceBandProducts,
    compareProducts: input.compareProducts,
    brandAuthorityEntries: input.brandAuthorityEntries,
    merchantCurrency: input.merchantCurrency,
  });
  const guideLinks =
    input.categorySlug in CONTENT_CLUSTER_SUPPORT
      ? buildCommercialGuideLinks({
          storeUrl: input.storeUrl,
          posts: input.guidePosts ?? [],
          context: {
            pageKind: 'category',
            categorySlug: input.categorySlug as SupportedClusterCategory,
          },
        })
      : [];

  return {
    intro,
    trustFeatures,
    bestForCards,
    brandCards,
    priceBandCards,
    comparisonLinks:
      input.comparisonLinks ??
      buildCategorySupportLinks({
        storeUrl: input.storeUrl,
        categorySlug: input.categorySlug,
        categoryName: input.categoryName,
        products: input.priceBandProducts ?? input.products,
        compareProducts: input.compareProducts,
        merchantCurrency: input.merchantCurrency,
      }),
    guideLinks,
    faqItems,
  };
}
