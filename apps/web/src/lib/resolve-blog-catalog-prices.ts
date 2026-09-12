import sanitizeLib from 'sanitize-html';
import { isPublicVariantPurchasable } from './is-public-variant-purchasable';
import { getEffectiveStock } from './product-stock';
import { formatMerchantCurrency } from './resolve-merchant-currency';
import { createSanitizeHtmlOptions } from './sanitize-html-config';
import {
  getProductPriceRange,
  type ProductPriceSeoProduct,
} from './storefront-product-price-seo';

type CatalogProduct = Omit<ProductPriceSeoProduct, 'variants'> & {
  id: string;
  has_condition_offers?: boolean | null;
  has_purchasable_variant?: boolean;
  has_purchasable_condition_offer?: boolean;
  variants?: Array<{
    id?: string;
    price_override?: number | null;
    stock_quantity?: number | null;
    inventory_tracking_policy?: string | null;
  }>;
};
type Options = {
  products: readonly CatalogProduct[];
  currencySource?: { country?: string | null; payout_currency?: string | null };
};
const UUID = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
const PRICE_REFERENCE = new RegExp(
  `\\{\\{catalog-price:(${UUID})(?::variant:(${UUID}))?\\}\\}`,
  'gi'
);

function resolvePrice(
  product: CatalogProduct | undefined,
  variantId: string | undefined,
  options: Options
) {
  if (!product || !options.currencySource) return 'Check current price';
  if (variantId) {
    const variant = product.variants?.find(
      (row) => row.id?.toLowerCase() === variantId.toLowerCase()
    );
    if (!variant) return 'Check current price';
    if (!isPublicVariantPurchasable(product, variant))
      return 'Currently unavailable';
    const price = variant.price_override ?? product.price;
    return typeof price === 'number' && Number.isFinite(price) && price >= 0
      ? formatMerchantCurrency(price, options.currencySource)
      : 'Check current price';
  }
  const hasAlternative =
    product.variants?.some((variant) =>
      isPublicVariantPurchasable(product, variant)
    ) ||
    product.offers?.some(
      (offer) =>
        offer &&
        (offer.status == null || offer.status === 'active') &&
        getEffectiveStock(offer) > 0
    );
  if (
    !hasAlternative &&
    ((product.has_variants === true &&
      product.has_purchasable_variant === false) ||
      (product.has_condition_offers === true &&
        product.has_purchasable_condition_offer === false) ||
      (product.manage_stock === true && getEffectiveStock(product) <= 0))
  ) {
    return 'Currently unavailable';
  }
  // Never fall back to a misleading parent price when selectable inventory is missing.
  if (
    (product.has_variants && !product.variants?.length) ||
    (product.has_condition_offers && !product.offers?.length)
  )
    return 'Check current price';
  const range = getProductPriceRange(product);
  if (!range) return 'Check current price';
  const min = formatMerchantCurrency(range.min, options.currencySource);
  return range.hasRange
    ? `${min}–${formatMerchantCurrency(range.max, options.currencySource)}`
    : min;
}

/** Resolves explicit references from tenant-scoped hydrated data; never reads the DB. */
export function resolveBlogCatalogPrices(
  content: { html?: string; json?: unknown },
  options: Options
) {
  const products = new Map(
    options.products.map((product) => [product.id.toLowerCase(), product])
  );
  const replace = (text: string) =>
    text.replace(PRICE_REFERENCE, (_match, id: string, variantId?: string) =>
      resolvePrice(products.get(id.toLowerCase()), variantId, options)
    );
  const visit = (value: unknown, inCode = false): unknown => {
    if (Array.isArray(value)) return value.map((child) => visit(child, inCode));
    if (!value || typeof value !== 'object') return value;
    const node = value as Record<string, unknown>;
    const code =
      inCode ||
      node.type === 'codeBlock' ||
      (Array.isArray(node.marks) &&
        node.marks.some(
          (mark: unknown) =>
            mark !== null &&
            typeof mark === 'object' &&
            'type' in mark &&
            mark.type === 'code'
        ));
    return {
      ...node,
      ...(node.type === 'text' && typeof node.text === 'string' && !code
        ? { text: replace(node.text) }
        : {}),
      ...(Array.isArray(node.content)
        ? { content: visit(node.content, code) }
        : {}),
    };
  };
  let codeDepth = 0;
  const html =
    content.html && /\{\{catalog-price:/i.test(content.html)
      ? sanitizeLib(content.html, {
          ...createSanitizeHtmlOptions({}),
          onOpenTag: (tag) => {
            if (tag === 'code' || tag === 'pre') codeDepth++;
          },
          onCloseTag: (tag) => {
            if (tag === 'code' || tag === 'pre') codeDepth--;
          },
          textFilter: (text) => (codeDepth ? text : replace(text)),
        })
      : content.html;
  return { html, json: visit(content.json) };
}
