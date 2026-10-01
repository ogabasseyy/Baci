import { CONTENT_CLUSTER_SUPPORT } from '@/config/storefront-content-clusters';
import { buildStoreUrl } from '@/lib/store-url';
import { brandAuthorityPageLoader } from '@/lib/storefront-category/load-brand-authority-page';
import { modelFamilyAuthorityTaxonomy } from '@/lib/storefront-category/model-family-authority-taxonomy';
import { buildCommercialGuideLinks } from '@/lib/storefront-content/build-commercial-guide-links';
import type { SupportedClusterCategory } from '@/lib/storefront-content/content-cluster-types';
import { loadPublishedClusterPostsSafely } from '@/lib/storefront-content/load-published-cluster-posts-safely';
import { getCountryShoppingContext } from '@/lib/storefront-localization';
import { buildStorefrontMetadataTitle } from '@/lib/storefront-metadata-title';

async function loadModelFamilyAuthorityPage(args: {
  merchantSlug: string;
  categorySlug: string;
  brandSlug: string;
  familySlug: string;
}) {
  const family = modelFamilyAuthorityTaxonomy.getEntry(
    args.categorySlug,
    args.brandSlug,
    args.familySlug
  );
  if (!family) return null;

  const brandPage = await brandAuthorityPageLoader.load(
    {
      merchantSlug: args.merchantSlug,
      categorySlug: args.categorySlug,
      brandSlug: args.brandSlug,
    },
    { includeGuideLinks: false, includeRequestPathPrefix: false }
  );
  if (!brandPage) return null;

  const products = brandPage.products.filter((product) =>
    modelFamilyAuthorityTaxonomy.matchesProduct(family, product.name)
  );
  if (products.length < family.minimumProducts) return null;

  const canonicalUrl = `${brandPage.canonicalUrl}/families/${family.familyKey}`;
  const countryContext = getCountryShoppingContext(brandPage.merchant.country);
  const countrySuffix = countryContext ? ` ${countryContext}` : '';
  const heading = `${family.displayName} Phones and Prices${countrySuffix}`;
  const supportedCategory =
    args.categorySlug in CONTENT_CLUSTER_SUPPORT
      ? (args.categorySlug as SupportedClusterCategory)
      : null;
  const guideContext = supportedCategory
    ? {
        pageKind: 'category' as const,
        categorySlug: supportedCategory,
        brands: [brandPage.brand.displayName, brandPage.brand.brandKey],
        modelFamilySlug: family.familyKey,
        productNames: products.map((product) => product.name),
        productSlugs: products.map((product) => product.slug),
      }
    : null;
  const guidePosts = guideContext
    ? await loadPublishedClusterPostsSafely(brandPage.merchant.id, guideContext)
    : [];

  return {
    ...brandPage,
    canonicalUrl,
    heading,
    intro: `Compare ${products.length} available ${family.displayName} phones from ${brandPage.merchant.business_name}, including current prices, specifications, condition, and availability.`,
    metaTitle: buildStorefrontMetadataTitle({
      title: heading,
      suffix: brandPage.merchant.business_name,
      fallback: family.displayName,
    }).title,
    metaDescription: `Compare ${products.length} ${family.displayName} phones from ${brandPage.merchant.business_name}, with current prices, specifications, condition, and availability${countrySuffix}.`,
    products,
    guideLinks: guideContext
      ? buildCommercialGuideLinks({
          storeUrl: buildStoreUrl(brandPage.merchant),
          posts: guidePosts,
          context: guideContext,
        })
      : [],
    brand: { ...brandPage.brand, displayName: family.displayName },
    familyLinks: [],
    breadcrumbItems: [
      ...brandPage.breadcrumbItems,
      { name: family.displayName, url: canonicalUrl },
    ],
  };
}

export const modelFamilyAuthorityPageLoader = {
  load: loadModelFamilyAuthorityPage,
};
