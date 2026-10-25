import { CategoryHubSections } from '@/components/storefront/ogabassey/seo/category-hub-sections';
import type { CategoryHubModel } from '@/lib/storefront-category/category-hub-types';
import { buildPriceBandGuideLink } from '@/lib/storefront-compare/build-commercial-support-links';
import { loadPriceBandPage } from '@/lib/storefront-compare/load-price-band-page';
import { loadCategoryPageCompareLinks } from './category-page-compare-links';

interface CategoryPageDeferredCompareLinksProps {
  storeUrl: string;
  merchantId: string;
  merchantSlug: string;
  categorySlug: string;
  categoryName: string;
}

function buildComparisonOnlyHubModel(
  comparisonLinks: CategoryHubModel['comparisonLinks']
): CategoryHubModel {
  return {
    intro: {
      heading: '',
      description: '',
      source: 'fallback',
    },
    trustFeatures: [],
    bestForCards: [],
    brandCards: [],
    priceBandCards: [],
    comparisonLinks,
    guideLinks: [],
    faqItems: [],
  };
}

async function loadLaptopGuideLink({
  categorySlug,
  merchantSlug,
  storeUrl,
}: CategoryPageDeferredCompareLinksProps) {
  if (categorySlug !== 'laptops') return null;
  // Page slices do not establish category-wide eligibility. Reuse the guide's
  // public offer loader so this inbound link matches its actual destination.
  try {
    const page = await loadPriceBandPage(
      { merchantSlug, categorySlug, priceBandSlug: 'under-1m' },
      { includeRequestPathPrefix: false }
    );
    return buildPriceBandGuideLink({
      storeUrl,
      categorySlug,
      priceBandSlug: 'under-1m',
      isIndexable: page?.isIndexable ?? false,
    });
  } catch {
    // Optional navigation must not fail the catalog page.
    return null;
  }
}

export async function CategoryPageDeferredCompareLinks({
  storeUrl,
  merchantId,
  merchantSlug,
  categorySlug,
  categoryName,
}: CategoryPageDeferredCompareLinksProps) {
  const [graphLinks, guideLink] = await Promise.all([
    loadCategoryPageCompareLinks({
      storeUrl,
      merchantId,
      categorySlug,
      categoryName,
    }),
    loadLaptopGuideLink({
      storeUrl,
      merchantId,
      merchantSlug,
      categorySlug,
      categoryName,
    }),
  ]);
  const comparisonLinks = guideLink ? [...graphLinks, guideLink] : graphLinks;

  if (comparisonLinks.length === 0) {
    return null;
  }

  return (
    <CategoryHubSections
      comparisonHeading={
        categorySlug === 'laptops'
          ? 'More shopping comparisons'
          : 'More product comparisons'
      }
      headingIdPrefix="maintained-category-comparisons"
      hub={buildComparisonOnlyHubModel(comparisonLinks)}
    />
  );
}
