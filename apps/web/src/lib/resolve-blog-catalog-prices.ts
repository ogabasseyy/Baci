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
  // Exhausted offers only make the whole product unavailable when the base
  // product is also unavailable: a stocked base remains directly purchasable
  // (mirroring the related-product card predicate). Confirmed-empty variant
  // sets stay sufficient on their own because the PDP rejects add-to-cart
  // without a selectable variant.
  // The categorized PDP normalizes legacy null manage_stock to managed
  // inventory; match it so a zero-stock legacy base token is unavailable
  // instead of rendering the parent price. An ABSENT policy (undefined)
  // means no inventory data was projected at all, so it stays fail-open.
  const isBaseOutOfStock =
    (product.manage_stock === true || product.manage_stock === null) &&
    getEffectiveStock(product) <= 0;
  if (
    !hasAlternative &&
    ((product.has_variants === true &&
      product.has_purchasable_variant === false) ||
      (product.has_condition_offers === true &&
        product.has_purchasable_condition_offer === false &&
        isBaseOutOfStock) ||
      isBaseOutOfStock)
  ) {
    return 'Currently unavailable';
  }
  // A hydrated-but-empty offer projection (e.g., every row filtered as
  // same-condition) carries no offer signal: when the base is directly
  // purchasable, fall through to its price instead of "Check current
  // price". Confirmed-empty variant sets keep the fallback — they have no
  // selectable SKU. Never fall back to a misleading parent price when
  // selectable inventory is missing.
  const offersKnownEmpty =
    Array.isArray(product.offers) && product.offers.length === 0;
  const variantSelectionEmpty =
    product.has_variants === true && product.has_purchasable_variant === false;
  if (
    (product.has_variants && !product.variants?.length) ||
    (product.has_condition_offers &&
      !product.offers?.length &&
      !(offersKnownEmpty && !variantSelectionEmpty))
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
