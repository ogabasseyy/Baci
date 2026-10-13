import { buildOgabasseyProductSpecData } from '@/components/storefront/ogabassey/product-spec-data';
import type { CachedMerchant } from '@/lib/cached-data';
import type { Product } from '@/lib/products';
import {
  generateBreadcrumbSchema,
  generateProductSchema,
  generateSlug,
  getValidatedProductUrl,
} from '@/lib/seo-utils';
import type { MerchantTrustProfile } from '@/lib/storefront-trust/merchant-trust-profile-types';

interface CategoryProductStructuredDataInput {
  product: Product;
  merchant: Pick<
    CachedMerchant,
    'business_name' | 'slug' | 'country' | 'logo_url'
  >;
  baseUrl: string;
  currency: string;
  trustProfile: MerchantTrustProfile;
  acceptedPaymentMethods: readonly string[];
}

// Assemble server-rendered product and breadcrumb facts together so they use
// the same validated product URL, merchant identity and currency.
export function buildCategoryProductStructuredData({
  product,
  merchant,
  baseUrl,
  currency,
  trustProfile,
  acceptedPaymentMethods,
}: CategoryProductStructuredDataInput) {
  const derivedSpecData = buildOgabasseyProductSpecData(product);
  const schemaProduct =
    derivedSpecData.detailedSpecs.length > 0
      ? { ...product, specifications: derivedSpecData.detailedSpecs }
      : product;
  const productUrl = getValidatedProductUrl(product, baseUrl, merchant.slug);
  const productSchema = generateProductSchema(
    schemaProduct,
    merchant.business_name || 'Baci Store',
    currency,
    merchant.country || 'NG',
    merchant.logo_url,
    trustProfile,
    { acceptedPaymentMethods, productUrl }
  );
  const categorySlug =
    product.categories?.slug ||
    product.category_slug ||
    (product.category ? generateSlug(product.category) : null);
  const categoryUrl = categorySlug
    ? `${baseUrl}/${categorySlug}`
    : `${baseUrl}/products`;
  const breadcrumbSchema = generateBreadcrumbSchema([
    { name: merchant.business_name || 'Home', url: baseUrl },
    { name: product.category || 'All Products', url: categoryUrl },
    { name: product.name, url: productUrl },
  ]);

  return { derivedSpecData, productSchema, breadcrumbSchema };
}
