import { CONTENT_CLUSTER_SUPPORT } from '@/config/storefront-content-clusters';
import { buildStoreUrl } from '@/lib/store-url';
import { BRAND_AUTHORITY_PRODUCT_LIMIT } from '@/lib/storefront-category/brand-authority-product-limit';
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

  const brandInventory = brandPage.brandInventory ?? {
    products: brandPage.products,
  };
  const allMatchedProducts = brandInventory.products.filter((product) =>
    modelFamilyAuthorityTaxonomy.matchesProduct(family, product.name)
  );
  if (allMatchedProducts.length < family.minimumProducts) return null;

  const matchedProducts = allMatchedProducts.slice(
    0,
    BRAND_AUTHORITY_PRODUCT_LIMIT
  );

  const siblingFamilyLinks = modelFamilyAuthorityTaxonomy
    .getEntries(args.categorySlug, brandPage.brand.brandKey)
    .filter((entry) => entry.familyKey !== family.familyKey)
    .flatMap((entry) => {
      const productCount = brandInventory.products.filter((product) =>
        modelFamilyAuthorityTaxonomy.matchesProduct(entry, product.name)
      ).length;
      return productCount >= entry.minimumProducts
        ? [
            {
              href: `${brandPage.canonicalUrl}/families/${entry.familyKey}`,
              label: `${entry.displayName} phones`,
              productCount,
            },
          ]
        : [];
    });

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
        productNames: matchedProducts.map((product) => product.name),
        productSlugs: matchedProducts.map((product) => product.slug),
      }
    : null;
  const guidePosts = guideContext
    ? await loadPublishedClusterPostsSafely(brandPage.merchant.id, guideContext)
    : [];

  return {
    ...brandPage,
    canonicalUrl,
    heading,
    intro: `Compare ${matchedProducts.length} available ${family.displayName} phones from ${brandPage.merchant.business_name}, including current prices, specifications, condition, and availability.`,
    metaTitle: buildStorefrontMetadataTitle({
      title: heading,
      suffix: brandPage.merchant.business_name,
      fallback: family.displayName,
    }).title,
    metaDescription: `Compare ${matchedProducts.length} ${family.displayName} phones from ${brandPage.merchant.business_name}, with current prices, specifications, condition, and availability${countrySuffix}.`,
    products: matchedProducts,
    guideLinks: guideContext
      ? buildCommercialGuideLinks({
          storeUrl: buildStoreUrl(brandPage.merchant),
          posts: guidePosts,
          context: guideContext,
        })
      : [],
    brand: { ...brandPage.brand, displayName: family.displayName },
    familyLinks: siblingFamilyLinks,
    breadcrumbItems: [
      ...brandPage.breadcrumbItems,
      { name: family.displayName, url: canonicalUrl },
    ],
  };
}

export const modelFamilyAuthorityPageLoader = {
  load: loadModelFamilyAuthorityPage,
};
