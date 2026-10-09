import NetInfo from '@react-native-community/netinfo';
import { createLogger } from '@/lib/logger';
import { getStorefrontProductVariantsByProductIds } from '@/lib/storefront-product-variants';
import { supabase } from '@/lib/supabase';
import { useCartStore } from '@/stores/cart-store';
import type { CartItem } from '@/stores/cart-store.types';
import { resolveOfferEffectiveStock } from './cart-stock-offers';

const log = createLogger('Cart');

export type AddToCartInput = Omit<CartItem, 'id'>;

interface StockCheckResult {
  available: boolean;
  currentStock: number;
  requestedQuantity: number;
}

async function checkNetwork(): Promise<boolean> {
  const state = await NetInfo.fetch();
  return state.isConnected === true && state.isInternetReachable !== false;
}

function getExistingCartQuantityForStock(item: AddToCartInput): number {
  const variantId = item.variant_id ?? null;
  const offerId = item.offer_id ?? null;
  return useCartStore
    .getState()
    .items.reduce(
      (total, cartItem) =>
        cartItem.product_id === item.product_id &&
        (cartItem.variant_id ?? null) === variantId &&
        (cartItem.offer_id ?? null) === offerId
          ? total + cartItem.quantity
          : total,
      0
    );
}

function getIncomingCartQuantityForStock(item: AddToCartInput): number {
  return item.voucher_token || item.voucher_award_id ? 1 : item.quantity;
}

export function getTotalRequestedQuantityForStock(item: AddToCartInput) {
  return (
    getExistingCartQuantityForStock(item) +
    getIncomingCartQuantityForStock(item)
  );
}

/**
 * Check stock availability from the database.
 *
 * @param cachedStock - Last known stock from TanStack Query cache, used as
 *   fallback when offline or on query error. If no cached value exists,
 *   stock check will fail to prevent overselling.
 * @param options.variantId - Selected variant identity. A managed option
 *   validates its own effective stock instead of the parent total, so a
 *   stocked variant on a zero-stock parent stays purchasable.
 * @param options.offerId - Selected condition-offer identity. Validated
 *   against the offer's own effective stock capped by strict serialized
 *   base units; a null offer quantity inherits the base effective stock,
 *   mirroring the PDP predicate.
 */
export async function checkStock(
  productId: string,
  requestedQuantity: number,
  cachedStock?: number,
  options?: { variantId?: string | null; offerId?: string | null }
): Promise<StockCheckResult> {
  const isOnline = await checkNetwork();
  if (!isOnline) {
    if (cachedStock === undefined) {
      log.error(
        'Offline: No cached stock data available, blocking add-to-cart'
      );
      throw new Error(
        'Cannot verify stock while offline. Please try again when connected.'
      );
    }
    log.warn(
      `Offline: Stock check skipped, using cached estimate (${cachedStock})`
    );
    return {
      available: requestedQuantity <= cachedStock,
      currentStock: cachedStock,
      requestedQuantity,
    };
  }

  const { data, error } = await supabase
    .from('products')
    .select('stock_quantity, stock, manage_stock')
    .eq('id', productId)
    .single();

  if (error) {
    log.error('Stock check failed:', error);
    if (cachedStock === undefined) {
      throw new Error('Cannot verify stock availability. Please try again.');
    }
    return {
      available: requestedQuantity <= cachedStock,
      currentStock: cachedStock,
      requestedQuantity,
    };
  }

  // Only an explicit false bypasses stock checks: legacy NULL rows are
  // managed inventory (platform policy shared with search and the PDPs).
  if (data?.manage_stock === false) {
    return {
      available: true,
      currentStock: Number.MAX_SAFE_INTEGER,
      requestedQuantity,
    };
  }

  // Mirror the refined-search/PDP effective-stock fallback: a zero
  // stock_quantity with a positive legacy stock column still sells.
  const trackedQuantity = data?.stock_quantity ?? 0;
  const legacyQuantity = data?.stock ?? 0;
  const parentStock =
    trackedQuantity === 0 && legacyQuantity > 0
      ? legacyQuantity
      : trackedQuantity;

  // Offers exist only for non-variant products, so a variant identity
  // always wins when both are present (defensive: callers never send both).
  const currentStock = options?.variantId
    ? await resolveVariantEffectiveStock(
        productId,
        options.variantId,
        parentStock
      )
    : options?.offerId
      ? await resolveOfferEffectiveStock(
          productId,
          options.offerId,
          parentStock
        )
      : await resolveBaseEffectiveStock(productId, parentStock);
  return {
    available: currentStock >= requestedQuantity,
    currentStock,
    requestedQuantity,
  };
}

/**
 * Variant effective stock through the same unbounded storefront projection
 * the PDP hydrates (get_storefront_product_variants, paginated past any
 * population cap). The search MCP projection this check previously read is
 * capped at 129 rows per product, so a selectable later variant reported
 * zero and rolled back an available add. Unlimited tracking bypasses;
 * strict compares the projection's exact available_units; other policies
 * use the finite quantity with parent inheritance, mirroring the
 * price-options CTE. A variant absent from the projection (vanished or
 * unpublished) reports zero; other lookup failures throw so the caller
 * retries instead of overselling.
 */
async function resolveVariantEffectiveStock(
  productId: string,
  variantId: string,
  parentStock: number
): Promise<number> {
  const variantsByProduct = await getStorefrontProductVariantsByProductIds([
    productId,
  ]);
  if (!variantsByProduct) {
    throw new Error('Cannot verify stock availability. Please try again.');
  }
  const row = (variantsByProduct[productId] ?? []).find(
    (entry) => entry?.id === variantId
  );
  if (!row) {
    log.error('Variant stock check found no such variant:', variantId);
    return 0;
  }
  if (row.effective_policy === 'serialized_then_unlimited') {
    return Number.MAX_SAFE_INTEGER;
  }
  if (row.effective_policy === 'serialized_strict') {
    if (
      typeof row.available_units === 'number' &&
      Number.isFinite(row.available_units)
    ) {
      return Math.max(0, row.available_units);
    }
    log.error('Variant stock check found no unit count:', variantId);
    throw new Error('Cannot verify stock availability. Please try again.');
  }
  return typeof row.stock_quantity === 'number' &&
    Number.isFinite(row.stock_quantity)
    ? row.stock_quantity
    : parentStock;
}

/**
 * Base-option effective stock through the shopper-safe base inventory
 * projection (anchor-first effective policy plus base available units).
 * Unlimited tracking bypasses; strict compares exact units; other
 * policies use the scalar parent stock, mirroring the price-options base
 * branch and the PDP predicate. A product absent from the projection
 * (vanished or unpublished) reports zero; other lookup failures throw so
 * the caller retries instead of overselling.
 */
async function resolveBaseEffectiveStock(
  productId: string,
  parentStock: number
): Promise<number> {
  const { data, error } = await supabase.rpc(
    'get_storefront_product_base_inventory',
    { p_product_ids: [productId] }
  );
  if (error) {
    log.error('Base stock check failed:', error);
    throw new Error('Cannot verify stock availability. Please try again.');
  }
  const row = (Array.isArray(data) ? data : []).find(
    (entry: { product_id?: unknown }) => entry?.product_id === productId
  ) as
    | {
        effective_policy?: unknown;
        available_units?: unknown;
      }
    | undefined;
  if (!row) {
    log.error('Base stock check found no such product:', productId);
    return 0;
  }
  if (row.effective_policy === 'serialized_then_unlimited') {
    return Number.MAX_SAFE_INTEGER;
  }
  if (row.effective_policy === 'serialized_strict') {
    if (
      typeof row.available_units === 'number' &&
      Number.isFinite(row.available_units)
    ) {
      return Math.max(0, row.available_units);
    }
    log.error('Base stock check found no unit count:', productId);
    throw new Error('Cannot verify stock availability. Please try again.');
  }
  return parentStock;
}
