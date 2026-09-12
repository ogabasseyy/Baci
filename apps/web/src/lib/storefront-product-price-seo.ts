import { isPublicVariantPurchasable } from './is-public-variant-purchasable';
import { getEffectiveStock } from './product-stock';
import {
  appendCountryContext,
  getCountryShoppingContext,
  getStorefrontLocale,
} from './storefront-localization';
import { getSeoProductName } from './storefront-product-slug-disambiguation';

interface ProductPriceSeoVariant {
  inventory_tracking_policy?: string | null;
  price_override?: number | null;
  stock_quantity?: number | null;
}

interface ProductPriceSeoOffer {
  price?: number | null;
  status?: string | null;
  stock_quantity?: number | null;
}

export interface ProductPriceSeoProduct {
  name: string;
  slug?: string | null;
  has_variants?: boolean | null;
  price?: number | null;
  base_price?: number | null;
  sale_price?: number | null;
  min_variant_price?: number | null;
  max_variant_price?: number | null;
  manage_stock?: boolean | null;
  stock?: number | null;
  stock_quantity?: number | null;
  variants?: Array<ProductPriceSeoVariant | null | undefined> | null;
  offers?: Array<ProductPriceSeoOffer | null | undefined> | null;
}

export interface ProductPriceRange {
  min: number;
  max: number;
  hasRange: boolean;
}

interface BuildProductPriceSeoCopyInput {
  product: ProductPriceSeoProduct;
  merchantDisplayName: string;
  categoryName: string;
  currency: string;
  country?: string | null;
}

function toFinitePrice(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function addPriceCandidate(
  candidates: number[],
  value: number | null | undefined
) {
  const price = toFinitePrice(value);
  if (price !== null) {
    candidates.push(price);
  }
}

function isActiveOffer(offer: ProductPriceSeoOffer | null | undefined) {
  return (
    offer?.status === undefined ||
    offer.status === null ||
    offer.status === 'active'
  );
}

function hasAdvertisableStock(
  product: ProductPriceSeoProduct,
  stockQuantity: number | null | undefined
) {
  if (product.manage_stock === false || product.manage_stock === null) {
    return true;
  }

  return stockQuantity === undefined || stockQuantity === null
    ? true
    : stockQuantity > 0;
}

function hasAdvertisableChildStock(
  product: ProductPriceSeoProduct,
  stockQuantity: number | null | undefined
) {
  // An unmanaged parent (including legacy null values) has unlimited stock.
  // Its child quantities are informational and must not hide a purchasable
  // variant or offer from the advertised price range.
  if (product.manage_stock === false || product.manage_stock === null) {
    return true;
  }

  if (stockQuantity === undefined) {
    return true;
  }

  if (stockQuantity === null) {
    const parentStock = product.stock_quantity ?? product.stock;
    return parentStock === undefined || parentStock === null
      ? true
      : getEffectiveStock(product) > 0;
  }

  return stockQuantity > 0;
}

export function getProductPriceRange(
  product: ProductPriceSeoProduct
): ProductPriceRange | null {
  const candidates: number[] = [];

  const variants = (product.variants ?? []).filter(
    (variant): variant is ProductPriceSeoVariant => Boolean(variant)
  );
  const hasSelectableVariants =
    product.has_variants === true && variants.length > 0;

  if (
    !hasSelectableVariants &&
    hasAdvertisableStock(product, product.stock_quantity ?? product.stock)
  ) {
    addPriceCandidate(
      candidates,
      toFinitePrice(product.sale_price) ??
        toFinitePrice(product.price) ??
        product.base_price
    );
  }
  if (variants.length === 0) {
    addPriceCandidate(candidates, product.min_variant_price);
    addPriceCandidate(candidates, product.max_variant_price);
  }

  for (const variant of variants) {
    const isSerialized =
      variant.inventory_tracking_policy === 'serialized_strict' ||
      variant.inventory_tracking_policy === 'serialized_then_unlimited';
    if (
      isSerialized
        ? isPublicVariantPurchasable(product, variant)
        : hasAdvertisableChildStock(product, variant.stock_quantity)
    ) {
      // A nullable override inherits the parent product price at checkout.
      // Keep that inherited amount in the advertised range without adding the
      // parent as a separate selectable SKU.
      addPriceCandidate(candidates, variant.price_override ?? product.price);
    }
  }

  for (const offer of (product.offers ?? []).filter(isActiveOffer)) {
    if (hasAdvertisableChildStock(product, offer?.stock_quantity)) {
      addPriceCandidate(candidates, offer?.price);
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  const min = Math.min(...candidates);
  const max = Math.max(...candidates);

  return {
    min,
    max,
    hasRange: min !== max,
  };
}

const _productPriceFormatterCache = new Map<string, Intl.NumberFormat>();
function getProductPriceFormatter(
  locale: string,
  currency: string,
  isInteger: boolean
): Intl.NumberFormat {
  const key = `${locale}:${currency}:${isInteger ? 'int' : 'frac'}`;
  let formatter = _productPriceFormatterCache.get(key);
  if (!formatter) {
    const options: Intl.NumberFormatOptions = {
      style: 'currency',
      currency,
    };

    if (isInteger) {
      options.maximumFractionDigits = 0;
      options.minimumFractionDigits = 0;
    }

    formatter = new Intl.NumberFormat(locale, options);
    _productPriceFormatterCache.set(key, formatter);
  }
  return formatter;
}

function formatProductPrice(
  price: number,
  currency: string,
  locale = getStorefrontLocale()
): string {
  return getProductPriceFormatter(
    locale,
    currency,
    Number.isInteger(price)
  ).format(price);
}

export function formatProductPriceRange(
  range: ProductPriceRange | null,
  currency: string,
  locale = getStorefrontLocale()
): string | null {
  if (!range) {
    return null;
  }

  const min = formatProductPrice(range.min, currency, locale);

  if (!range.hasRange) {
    return min;
  }

  return `${min} - ${formatProductPrice(range.max, currency, locale)}`;
}

export function buildProductPriceSeoCopy({
  product,
  merchantDisplayName,
  categoryName,
  currency,
  country,
}: BuildProductPriceSeoCopyInput) {
  const range = getProductPriceRange(product);
  const locale = getStorefrontLocale(country);
  const priceText = formatProductPriceRange(range, currency, locale);
  const productName = getSeoProductName(product);
  const category = categoryName.toLowerCase();
  const countryContext = getCountryShoppingContext(country);
  const title = appendCountryContext(`${productName} Price`, countryContext);
  const pricePhrase = appendCountryContext(
    `${productName} price`,
    countryContext
  );

  if (!range || !priceText) {
    return {
      title,
      description: `Check ${pricePhrase} on ${merchantDisplayName}. Review current ${category} availability, condition, delivery, warranty, and payment options before you buy.`,
      answer: `Check the current ${pricePhrase} on ${merchantDisplayName}, including availability, condition, delivery, warranty, and payment options before you buy.`,
      priceText: null,
      range,
    };
  }

  if (range.hasRange) {
    const minPrice = formatProductPrice(range.min, currency, locale);
    const maxPrice = formatProductPrice(range.max, currency, locale);

    return {
      title,
      description: `${pricePhrase} starts from ${minPrice} on ${merchantDisplayName}. Compare variants, condition, warranty, delivery, and payment options before you buy.`,
      answer: `The ${pricePhrase} on ${merchantDisplayName} starts from ${minPrice} and goes up to ${maxPrice}, depending on storage, color, condition, and availability.`,
      priceText,
      range,
    };
  }

  return {
    title,
    description: `${pricePhrase} is ${priceText} on ${merchantDisplayName}. Check specs, condition, warranty, delivery, and flexible payment options before you buy.`,
    answer: `The ${pricePhrase} on ${merchantDisplayName} is ${priceText}. Check specs, condition, warranty, delivery, and payment options before you buy.`,
    priceText,
    range,
  };
}
