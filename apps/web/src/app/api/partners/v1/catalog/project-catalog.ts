import type { GoogleMerchantListing } from '@/app/api/feed/google-merchant/feed-builder';
import { logger } from '@/lib/logger';
import { toKobo } from '@/lib/shipping/to-kobo';
import type { CrossRemListingBinding } from '@/schemas/crossrem-listing-binding';
import { CONDITION_LABELS } from './condition-labels';
import { getSellableIdentity } from './sellable-identity';
import { sellableIdentityKey } from './sellable-identity-key';

const CROSSREM_PRICE_PERCENT = 106n;

function rejectBinding(message: string, listingId: string): never {
  logger.warn({ message, listingId });
  throw new Error(message);
}

function toListing(
  row: GoogleMerchantListing,
  binding: CrossRemListingBinding,
  availableQuantity: number
) {
  const basePriceMinor = toKobo(row.price);
  if (
    basePriceMinor === null ||
    !Number.isSafeInteger(basePriceMinor) ||
    basePriceMinor <= 0
  ) {
    rejectBinding('Invalid CrossRem merchandise price', binding.listingId);
  }

  const priceMinor = Number(
    (BigInt(basePriceMinor) * CROSSREM_PRICE_PERCENT + 50n) / 100n
  );
  if (!Number.isSafeInteger(priceMinor)) {
    rejectBinding('Invalid CrossRem selling price', binding.listingId);
  }

  const { product } = row;
  const categoryLabel =
    product.categories?.name?.trim() || product.category?.trim();
  const categoryKey = product.categories?.slug || product.category_slug || null;

  return {
    listing_id: binding.listingId,
    product_id: product.id,
    variant_id: row.variant?.id ?? null,
    offer_id: row.offer?.id ?? null,
    title: row.title,
    image_url: row.imageUrl,
    product_url: row.url,
    product_type: categoryLabel
      ? { key: categoryKey, label: categoryLabel }
      : null,
    brand: product.brand?.trim() || binding.brandFallback || null,
    condition: binding.condition,
    condition_label: CONDITION_LABELS[binding.condition],
    base_price_minor: basePriceMinor,
    price_minor: priceMinor,
    availability: availableQuantity > 0 ? 'in_stock' : 'out_of_stock',
    protection_included: false,
  };
}

export function projectCatalog(
  rows: GoogleMerchantListing[],
  bindings: readonly CrossRemListingBinding[],
  stockByListing?: Map<string, number>
) {
  const confirmedNewProducts = new Set(
    bindings
      .filter(
        (binding) =>
          !binding.retired &&
          !binding.variantId &&
          !binding.offerId &&
          binding.condition === 'new' &&
          binding.assumeNewWhenMissing
      )
      .map((binding) => binding.productId)
  );
  const rowsByIdentity = new Map<string, GoogleMerchantListing | null>();
  for (const row of rows) {
    const identity =
      getSellableIdentity(row) ??
      (!row.variant &&
      !row.offer &&
      row.product.condition == null &&
      confirmedNewProducts.has(row.product.id)
        ? { productId: row.product.id, condition: 'new' as const }
        : null);
    if (identity) {
      const key = sellableIdentityKey(identity);
      rowsByIdentity.set(key, rowsByIdentity.has(key) ? null : row);
    }
  }

  const listingIds = new Set<string>();
  const boundIdentities = new Set<string>();
  return bindings
    .flatMap((binding) => {
      if (listingIds.has(binding.listingId)) {
        rejectBinding('Duplicate CrossRem listing ID', binding.listingId);
      }
      listingIds.add(binding.listingId);

      const key = sellableIdentityKey(binding);
      if (boundIdentities.has(key)) {
        rejectBinding('Duplicate CrossRem sellable item', binding.listingId);
      }
      boundIdentities.add(key);
      if (binding.retired) return [];
      const row = rowsByIdentity.get(key);
      if (!row) return [];
      // The order writer reserves stock_quantity. Google can still show a
      // legacy stock count when that reservable quantity is zero.
      const managedStock = row.variant
        ? row.variant.stock_quantity
        : row.product.stock_quantity;
      const quoteStock = row.offer
        ? row.offer.stock_quantity
        : row.product.manage_stock === true
          ? managedStock
          : row.stock;
      const availableQuantity = quoteStock ?? 0;
      stockByListing?.set(binding.listingId, availableQuantity);
      return [toListing(row, binding, availableQuantity)];
    })
    .sort((a, b) =>
      a.listing_id < b.listing_id ? -1 : a.listing_id > b.listing_id ? 1 : 0
    );
}
