import type { Route } from 'next';
import { HoverPrefetchLink } from '@/components/ui/hover-prefetch-link';
import { isInventoryTrackedProduct } from '@/lib/is-inventory-tracked-product';
import { getEffectiveStock } from '@/lib/product-stock';
import { formatMerchantCurrency } from '@/lib/resolve-merchant-currency';
import { getStorefrontProductHref } from '@/lib/storefront-product-href';
import { getProductPriceRange } from '@/lib/storefront-product-price-seo';
import type { BlogRelatedProduct } from './blog-related-product';

type BlogRelatedProductsProps = {
  basePath: string;
  currencySource?: { country?: string | null; payout_currency?: string | null };
  products: BlogRelatedProduct[];
};

function formatRelatedProductPrice(
  product: BlogRelatedProduct,
  currencySource: BlogRelatedProductsProps['currencySource']
) {
  if (!currencySource) return null;

  // A variant-selling product has no meaningful parent price until its
  // variants resolve: a confirmed-empty set has no selectable SKU, and an
  // unresolved set (hydration error/skipped leaves variants unset without
  // the purchasable flag) may have none at the parent amount. Skip the
  // fallback in both cases, matching the inline-token path (which prints
  // "Check current price" there). Inline-supplied variants without summary
  // flags still price from their rows.
  if (
    product.has_variants === true &&
    product.has_purchasable_variant !== true &&
    (product.variants?.length ?? 0) === 0
  ) {
    return null;
  }

  // Unresolved-offer guard: when the offer projection never resolved
  // (hydration error/skipped leaves offers unset without the purchasable
  // flag), stocked offers may exist, so a depleted base price must not
  // print as the fallback. A confirmed-empty projection (offers: []) is
  // different: the base SKU itself remains directly purchasable, so the
  // base price still shows (matching the inline-token path).
  if (
    product.has_condition_offers === true &&
    product.offers === undefined &&
    product.has_purchasable_condition_offer !== true
  ) {
    return null;
  }

  // The price-range helper reserves unlimited semantics for explicit
  // `manage_stock: false`; legacy null is managed inventory (PDP parity).
  // Pass the original policy through so variant and offer prices follow
  // that contract (availability is normalized separately below).
  const range = getProductPriceRange(product);
  if (range) {
    const min = formatMerchantCurrency(range.min, currencySource);
    return range.hasRange
      ? `${min} - ${formatMerchantCurrency(range.max, currencySource)}`
      : min;
  }

  const hasSelectableAlternatives =
    (product.has_variants === true && (product.variants?.length ?? 0) > 0) ||
    (product.has_condition_offers === true &&
      (product.offers?.length ?? 0) > 0);
  if (hasSelectableAlternatives) return null;

  return typeof product.price === 'number' && Number.isFinite(product.price)
    ? formatMerchantCurrency(product.price, currencySource)
    : null;
}

function isRelatedProductUnavailable(product: BlogRelatedProduct) {
  const hasInventorySignal =
    product.manage_stock !== undefined ||
    product.stock !== undefined ||
    product.stock_quantity !== undefined;
  const hasDirectPurchasableVariant =
    product.variants?.some((variant) => getEffectiveStock(variant) > 0) ===
    true;
  const hasDirectPurchasableOffer =
    product.offers?.some((offer) => getEffectiveStock(offer) > 0) === true;
  const hasTrackedInventory = isInventoryTrackedProduct(
    product,
    (product.variants ?? []).map((variant) => ({
      product_id: product.id,
      inventory_tracking_policy: variant.inventory_tracking_policy,
    }))
  );
  // The categorized PDP normalizes legacy null manage_stock to managed
  // inventory (`manage_stock ?? true`); match it so the card cannot
  // advertise a zero-stock legacy row as available. The normalized policy
  // also governs the variant gate: a null-policy product with no
  // purchasable variant is unavailable even when the parent holds stock.
  const manageStock = product.manage_stock ?? true;
  const hasConfirmedUnavailableVariant =
    product.has_variants === true &&
    product.has_purchasable_variant === false &&
    (hasTrackedInventory ||
      manageStock === true ||
      (product.variants?.length ?? 0) === 0) &&
    !hasDirectPurchasableVariant;
  const hasOutOfStockManagedParent =
    manageStock === true &&
    hasInventorySignal &&
    getEffectiveStock(product) === 0;

  return (
    (hasConfirmedUnavailableVariant || hasOutOfStockManagedParent) &&
    !hasDirectPurchasableVariant &&
    !hasDirectPurchasableOffer &&
    product.has_purchasable_condition_offer !== true &&
    product.has_purchasable_variant !== true &&
    (!product.has_condition_offers ||
      product.has_purchasable_condition_offer === false) &&
    (!product.has_variants || product.has_purchasable_variant === false)
  );
}

export function BlogRelatedProducts({
  basePath,
  currencySource,
  products,
}: BlogRelatedProductsProps) {
  return (
    <section aria-labelledby="related-products-heading" className="mt-10">
      <h2 id="related-products-heading" className="mb-4 text-2xl font-bold">
        Popular Products Mentioned
      </h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Catalog-linked prices update automatically. Historical and other quoted
        prices remain as written. Open the product page to confirm the current
        price, selected variant and availability before buying.
      </p>
      <ul className="grid gap-3 md:grid-cols-2">
        {products.map((product) => {
          const href = getStorefrontProductHref(
            {
              id: product.id,
              name: product.name,
              slug: product.slug ?? undefined,
              category_slug: product.category_slug ?? undefined,
            },
            basePath
          );
          const formattedPrice = formatRelatedProductPrice(
            product,
            currencySource
          );

          return (
            <li key={product.id}>
              <HoverPrefetchLink
                href={href as Route}
                className="block rounded-xl border border-border px-4 py-3 text-sm font-medium text-foreground transition-colors hover:border-primary hover:text-primary"
              >
                <span className="flex items-center justify-between gap-3">
                  <span>{product.name}</span>
                  {formattedPrice ? (
                    <span className="text-muted-foreground text-xs">
                      {formattedPrice}
                    </span>
                  ) : null}
                </span>
              </HoverPrefetchLink>
              {isRelatedProductUnavailable(product) ? (
                <span className="mt-1 block px-4 text-xs text-muted-foreground">
                  Currently unavailable
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
