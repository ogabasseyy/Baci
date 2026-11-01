import type { ChatProductResult } from '@/ai/chat-product-result';
import { resolvePublicProductOption } from '@/lib/resolve-public-product-option';
import { normalizeStorefrontProductVariants } from '@/lib/storefront-product-variants';
import {
  hasConnectivityValue,
  isWifiOnlyConnectivity,
} from './fast-catalog-wifi';

export interface FastCatalogVariant {
  id: string;
  product_id: string;
  attributes?: Record<string, unknown> | null;
  price_override?: number | string | null;
  stock_quantity?: number | null;
  effective_policy?: string | null;
  available_units?: number | null;
  condition?: string | null;
  status?: string | null;
  is_active?: boolean | null;
  is_inventory_anchor?: boolean | null;
  archived_at?: string | null;
  deleted_at?: string | null;
}

export function selectFastCatalogProducts(
  products: ChatProductResult[],
  variants: FastCatalogVariant[],
  options: {
    isPhoneCategory: boolean;
    maxPrice?: number;
    exclusiveMaxPrice?: boolean;
    wifiOnly: boolean;
    phoneProductIds?: ReadonlySet<string>;
    parentWifiOnlyIds?: ReadonlySet<string>;
  }
): ChatProductResult[] {
  const withinBudget = (price: number) =>
    options.maxPrice === undefined ||
    (options.exclusiveMaxPrice
      ? price < options.maxPrice
      : price <= options.maxPrice);
  return products.filter((product) => {
    const isPhoneCategory =
      options.isPhoneCategory ||
      options.phoneProductIds?.has(product.id) === true;
    if (product.status !== 'active' || product.has_condition_offers)
      return false;
    const explicitlyNamedWifiOnly = /\bwi[\s-]*fi[\s-]*only\b/i.test(
      product.name
    );
    const namedWifiOnly =
      explicitlyNamedWifiOnly ||
      options.parentWifiOnlyIds?.has(product.id) === true;
    if (isPhoneCategory && explicitlyNamedWifiOnly && !options.wifiOnly)
      return false;
    const hasVariantOptions =
      product.has_variants === true || product.variant_model === 'sku_matrix';
    if (!hasVariantOptions) {
      if (isPhoneCategory && namedWifiOnly !== options.wifiOnly) return false;
      return (
        (!product.manage_stock || (product.stock ?? 0) > 0) &&
        Number.isFinite(product.price) &&
        product.price > 0 &&
        withinBudget(product.price)
      );
    }

    const choices = normalizeStorefrontProductVariants(
      variants.filter((variant) => variant.product_id === product.id),
      {
        merchantId: '',
        productId: product.id,
        parentStock: product.stock ?? 0,
      }
    );
    return choices.some((variant) => {
      const wifiOnlyOption =
        isWifiOnlyConnectivity(variant.attributes) ||
        (namedWifiOnly && !hasConnectivityValue(variant.attributes));
      if (isPhoneCategory && wifiOnlyOption !== options.wifiOnly) return false;
      const option = resolvePublicProductOption(product, { variant });
      return (
        option.purchasable &&
        typeof option.price === 'number' &&
        Number.isFinite(option.price) &&
        option.price > 0 &&
        withinBudget(option.price)
      );
    });
  });
}
