import { ProductSemanticSections } from '@/components/storefront/ogabassey/seo/product-semantic-sections';
import type { Product } from '@/lib/products';
import { resolveMerchantCurrencyConfig } from '@/lib/resolve-merchant-currency';
import {
  buildCompareLinkGraph,
  MAX_PRODUCT_COMPARE_LINKS,
} from '@/lib/storefront-link-modules/compare-link-graph';
import { buildProductContextParagraphs } from '@/lib/storefront-product/build-product-context-paragraphs';
import { buildProductSemanticModel } from '@/lib/storefront-product/build-product-semantic-model';
import {
  getCachedProductSeoLinkData,
  type ProductSeoLinkData,
} from '@/lib/storefront-product/get-cached-product-seo-link-data';
import { buildProductPriceSeoCopy } from '@/lib/storefront-product-price-seo';

interface OgabasseyPdpSemanticMerchant {
  business_name?: string | null;
  country?: string | null;
  custom_domain?: string | null;
  id: string;
  payout_currency?: string | null;
  feature_settings?: { blog_enabled?: boolean } | null;
}

export interface OgabasseyPdpSemanticSectionsProps {
  categoryName: string;
  categorySlug: string;
  merchant: OgabasseyPdpSemanticMerchant;
  product: Product;
  productComparePathPrefix: string;
  storeSlug: string;
  storeUrl: string;
}

export async function OgabasseyPdpSemanticSections({
  categoryName,
  categorySlug,
  merchant,
  product,
  productComparePathPrefix,
  storeSlug,
  storeUrl,
}: OgabasseyPdpSemanticSectionsProps) {
  // Strict, cache-isolated fetch: throws on a transient inventory failure so a
  // link-poor result is never cached (stale-while-revalidate serves last-good).
  // Server components cannot rely on client error boundaries during the initial
  // SSR pass, so cold-cache failures must degrade here before reaching the
  // route error boundary. Warm cache failures serve last-good data via
  // stale-while-revalidate and do not reach this catch.
  let seoLinkData: ProductSeoLinkData;

  try {
    seoLinkData = await getCachedProductSeoLinkData({
      blogEnabled: Boolean(merchant.feature_settings?.blog_enabled),
      categorySlug,
      merchantId: merchant.id,
      productBrand: product.brand,
      productId: String(product.id || ''),
      productName: product.name,
      productSlug: product.slug || String(product.id || ''),
      storeSlug,
    });
  } catch (error) {
    console.warn('Failed to load Ogabassey PDP semantic links', {
      merchantId: merchant.id,
      categorySlug,
      productId: product.id,
      error,
    });
    return null;
  }

  const { inventory, guidePosts, priorityGuidePostSlugs } = seoLinkData;
  const currentProduct = {
    slug: product.slug || String(product.id),
    name: product.name,
    brand: product.brand,
    condition: product.condition,
    price: product.price,
    stock: product.stock,
    category_slug: product.category_slug ?? categorySlug,
    product_key_specs: product.product_key_specs,
  };
  const compareInventory = inventory.some(
    (candidate) => candidate.slug === currentProduct.slug
  )
    ? inventory
    : [currentProduct, ...inventory];
  const productCompareLinks = buildCompareLinkGraph({
    storeUrl,
    categorySlug,
    categoryName,
    products: compareInventory,
    productsAreKnownActive: true,
    anchorProductSlug: currentProduct.slug,
    maxLinks: MAX_PRODUCT_COMPARE_LINKS,
  });
  const semanticModel = buildProductSemanticModel({
    storeUrl,
    merchantBusinessName: merchant.business_name || 'Baci Store',
    categorySlug,
    categoryName,
    countryCode: merchant.country,
    currentProduct,
    inventory,
    guidePosts,
    priorityGuidePostSlugs,
  });
  const priceSeoCopy = buildProductPriceSeoCopy({
    product,
    merchantDisplayName: merchant.business_name || 'Baci Store',
    categoryName,
    currency: resolveMerchantCurrencyConfig(merchant).code,
    country: merchant.country,
  });

  return (
    <ProductSemanticSections
      model={{
        ...semanticModel,
        contextParagraphs: buildProductContextParagraphs({
          categoryName,
          categorySlug,
          currentProduct,
          displayPriceText: priceSeoCopy.priceText,
          merchantBusinessName: merchant.business_name || 'Baci Store',
          semanticModel,
        }),
      }}
      productCompareLinks={productCompareLinks}
      productComparePathPrefix={productComparePathPrefix}
      merchantName={merchant.business_name || 'Baci Store'}
      productName={product.name}
    />
  );
}
