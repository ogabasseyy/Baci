import { headers } from 'next/headers';
import { CONTENT_CLUSTER_SUPPORT } from '@/config/storefront-content-clusters';
import {
  normalizeProduct,
  type ProductKeySpecsRecord,
  type RawDbProduct,
} from '@/lib/normalize-product';
import { buildStoreUrl } from '@/lib/store-url';
import { brandAuthorityPublicData } from '@/lib/storefront-category/brand-authority-public-data';
import { brandAuthorityTaxonomy } from '@/lib/storefront-category/brand-authority-taxonomy';
import { getCachedBrandAuthorityProducts } from '@/lib/storefront-category/get-cached-brand-authority-products';
import { modelFamilyAuthorityTaxonomy } from '@/lib/storefront-category/model-family-authority-taxonomy';
import { buildCommercialGuideLinks } from '@/lib/storefront-content/build-commercial-guide-links';
import type { SupportedClusterCategory } from '@/lib/storefront-content/content-cluster-types';
import { loadPublishedClusterPostsSafely } from '@/lib/storefront-content/load-published-cluster-posts-safely';
import { getCountryShoppingContext } from '@/lib/storefront-localization';
import { buildStorefrontMetadataTitle } from '@/lib/storefront-metadata-title';
import { evaluateStorefrontSlugSafety } from '@/lib/storefront-slug-safety';
import { isDomainIdentifier } from '@/lib/validation';

interface BrandAuthorityPageProduct {
  id: string;
  name: string;
  slug: string;
  category: string;
  category_slug: string;
  brand: string | null;
  price: number;
  condition: string;
  stock: number;
  availability: 'InStock' | 'OutOfStock';
  has_condition_offers: boolean;
  product_key_specs?: ProductKeySpecsRecord | null;
  image: string;
  description: string;
}

function isRawDbProduct(value: unknown): value is RawDbProduct {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'id' in value &&
      'name' in value &&
      'price' in value
  );
}

async function getBrandAuthorityStorefrontPathPrefix(
  routeIdentifier: string,
  merchantSlug: string
) {
  const headersList = await headers();

  return headersList.has('x-custom-domain') ||
    headersList.has('x-merchant-slug') ||
    isDomainIdentifier(routeIdentifier)
    ? ''
    : `/${merchantSlug}`;
}

async function loadBrandAuthorityPage(
  args: {
    merchantSlug: string;
    categorySlug: string;
    brandSlug: string;
  },
  options: {
    includeRequestPathPrefix?: boolean;
    includeGuideLinks?: boolean;
  } = {}
) {
  const merchant = await brandAuthorityPublicData.getMerchant(
    args.merchantSlug
  );
  if (!merchant) {
    return null;
  }

  if (
    !evaluateStorefrontSlugSafety(args.categorySlug).safe ||
    !evaluateStorefrontSlugSafety(args.brandSlug).safe
  ) {
    return null;
  }

  const authorityEntry = brandAuthorityTaxonomy.getEntry(
    args.categorySlug,
    args.brandSlug
  );
  if (!authorityEntry) {
    return null;
  }

  const categoryData = await brandAuthorityPublicData.getCategory(
    merchant.id,
    args.categorySlug
  );
  if (!categoryData) return null;

  let brandProducts: RawDbProduct[];
  try {
    brandProducts = await getCachedBrandAuthorityProducts(
      merchant.id,
      args.categorySlug,
      authorityEntry
    );
  } catch (error) {
    console.warn('Failed to load brand authority products', {
      merchantId: merchant.id,
      categorySlug: args.categorySlug,
      brandKey: authorityEntry.brandKey,
      error,
    });
    return null;
  }
  const normalizedProducts = (brandProducts as unknown[])
    .filter(isRawDbProduct)
    .map((product) =>
      normalizeProduct(product, { preferredCategorySlug: args.categorySlug })
    )
    .filter(
      (product) =>
        brandAuthorityTaxonomy.matchesBrand(
          authorityEntry,
          product.brand ?? null
        ) && product.availability === 'InStock'
    );
  const isIndexable =
    normalizedProducts.length >= authorityEntry.minimumProducts;
  if (!isIndexable) {
    return null;
  }

  const products: BrandAuthorityPageProduct[] = normalizedProducts.map(
    (product) => ({
      id: product.id,
      name: product.name,
      slug: product.slug,
      category: product.category,
      category_slug: product.category_slug,
      brand: product.brand,
      price: product.price,
      condition: product.condition,
      stock: product.stock,
      availability: product.availability,
      has_condition_offers: product.has_condition_offers ?? false,
      product_key_specs: product.product_key_specs,
      image: product.image,
      description: product.description,
    })
  );
  const storeUrl = buildStoreUrl(merchant);
  const categoryName = categoryData.name;
  const canonicalUrl = `${storeUrl}/${args.categorySlug}/brands/${authorityEntry.brandKey}`;
  const countryContext = getCountryShoppingContext(merchant.country);
  const countrySuffix = countryContext ? ` ${countryContext}` : '';
  const heading = `${authorityEntry.displayName} Phones and Prices${countrySuffix}`;
  const supportedCategory =
    args.categorySlug in CONTENT_CLUSTER_SUPPORT
      ? (args.categorySlug as SupportedClusterCategory)
      : null;
  const guideContext = supportedCategory
    ? {
        pageKind: 'category' as const,
        categorySlug: supportedCategory,
        brands: [
          authorityEntry.displayName,
          authorityEntry.brandKey,
          ...(authorityEntry.brandAliases ?? []),
        ],
        productNames: normalizedProducts.map((product) => product.name),
        productSlugs: normalizedProducts.map((product) => product.slug),
      }
    : null;
  const guidePosts =
    options.includeGuideLinks === false || !guideContext
      ? []
      : await loadPublishedClusterPostsSafely(merchant.id, guideContext);
  const familyLinks = modelFamilyAuthorityTaxonomy
    .getEntries(args.categorySlug, authorityEntry.brandKey)
    .flatMap((entry) => {
      const productCount = products.filter((product) =>
        modelFamilyAuthorityTaxonomy.matchesProduct(entry, product.name)
      ).length;
      return productCount >= entry.minimumProducts
        ? [
            {
              href: `${canonicalUrl}/families/${entry.familyKey}`,
              label: `${entry.displayName} phones`,
              productCount,
            },
          ]
        : [];
    });

  return {
    merchant,
    canonicalUrl,
    metaTitle: buildStorefrontMetadataTitle({
      title: heading,
      suffix: merchant.business_name,
      fallback: authorityEntry.displayName,
    }).title,
    metaDescription: `Compare a selection of ${products.length} ${authorityEntry.displayName} phones from ${merchant.business_name}, with current prices, key specs, condition, and availability${countrySuffix}.`,
    heading,
    intro: `Explore a selection of ${products.length} ${authorityEntry.displayName} phones from ${merchant.business_name}. Compare current prices, specifications, condition, and availability before choosing a model.`,
    categoryName,
    brand: authorityEntry,
    products,
    guideLinks:
      guideContext && options.includeGuideLinks !== false
        ? buildCommercialGuideLinks({
            storeUrl,
            posts: guidePosts,
            context: guideContext,
          })
        : [],
    familyLinks,
    breadcrumbItems: [
      { name: merchant.business_name, url: storeUrl },
      { name: categoryName, url: `${storeUrl}/${args.categorySlug}` },
      { name: authorityEntry.displayName, url: canonicalUrl },
    ],
    categoryUrl: `${storeUrl}/${args.categorySlug}`,
    pathPrefix:
      options.includeRequestPathPrefix === false
        ? ''
        : await getBrandAuthorityStorefrontPathPrefix(
            args.merchantSlug,
            merchant.slug
          ),
  };
}

export const brandAuthorityPageLoader = {
  getStorefrontPathPrefix: getBrandAuthorityStorefrontPathPrefix,
  load: loadBrandAuthorityPage,
};
