import NetInfo from '@react-native-community/netinfo';
import { createLogger } from '@/lib/logger';
import { supabase } from '@/lib/supabase';
import { useCartStore } from '@/stores/cart-store';
import type { CartItem } from '@/stores/cart-store.types';
import { resolveBaseStock } from './cart-stock-base';
import { resolveOfferStock } from './cart-stock-offers';
import { resolveVariantEffectiveStock } from './cart-stock-variant';

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

/**
 * Pre-reserved quiz-voucher lines redeem award inventory that was already
 * removed from the live pools during reservation: counting them against
 * live stock would reject paid lines for units that were never theirs.
 */
function isReservedVoucherLine(cartItem: {
  voucher_token?: string;
  voucher_award_id?: string;
}): boolean {
  return Boolean(cartItem.voucher_token || cartItem.voucher_award_id);
}

/**
 * Total units in the store for this product/variant/offer identity.
 * The add-to-cart mutation validates this store total (not store plus
 * incoming): onMutate already applied the incoming line optimistically
 * before mutationFn runs, so adding the incoming quantity again would
 * double-count it and reject in-stock adds.
 */
export function getExistingCartQuantityForStock(item: AddToCartInput): number {
  const variantId = item.variant_id ?? null;
  const offerId = item.offer_id ?? null;
  return useCartStore
    .getState()
    .items.reduce(
      (total, cartItem) =>
        !isReservedVoucherLine(cartItem) &&
        cartItem.product_id === item.product_id &&
        (cartItem.variant_id ?? null) === variantId &&
        (cartItem.offer_id ?? null) === offerId
          ? total + cartItem.quantity
          : total,
      0
    );
}

/**
 * Total units in the store for this product across the base line and
 * every variant/offer line. Under strict serialized tracking all of
 * those lines claim the same hidden-anchor units, so the aggregate —
 * not just the per-identity total — must fit the pool. Pre-reserved
 * voucher lines are excluded: their units left the pool at award time.
 */
export function getExistingProductQuantityForStock(productId: string): number {
  return useCartStore
    .getState()
    .items.reduce(
      (total, cartItem) =>
        !isReservedVoucherLine(cartItem) && cartItem.product_id === productId
          ? total + cartItem.quantity
          : total,
      0
    );
}

/**
 * Check stock availability from the database.
 *
 * @param cachedStock - Last known stock from TanStack Query cache, used as
 *   fallback when offline or on query error. Callers pass the exact
 *   option availability for option lines (see getCachedOptionStock); a
 *   parent fallback for an option line would misvalidate. If no cached
 *   value exists, stock check will fail to prevent overselling.
 * @param options.variantId - Selected variant identity. A managed option
 *   validates its own effective stock instead of the parent total, so a
 *   stocked variant on a zero-stock parent stays purchasable.
 * @param options.offerId - Selected condition-offer identity. Validated
 *   against the offer's own effective stock capped by strict serialized
 *   base units; a null offer quantity inherits the base effective stock,
 *   mirroring the PDP predicate.
 * @param options.aggregateQuantity - Post-optimistic store total for the
 *   product across the base line and every sibling offer. Under strict
 *   serialized tracking this aggregate must also fit the shared units;
 *   without it each sibling would independently validate against the
 *   same pool and over-claim. The offline estimate keeps the
 *   per-identity comparison (no live units available) and revalidates
 *   online; order creation enforces the cap regardless.
 */
export async function checkStock(
  productId: string,
  requestedQuantity: number,
  cachedStock?: number,
  options?: {
    variantId?: string | null;
    offerId?: string | null;
    aggregateQuantity?: number;
  }
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
  // Offer lines still resolve their own allocation: order creation
  // checks the offer scalar even on unmanaged parents. Variants resolve
  // too, so strict unit counts win over the shortcut below.
  if (
    data?.manage_stock === false &&
    !options?.offerId &&
    !options?.variantId
  ) {
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
  if (options?.variantId) {
    const currentStock = await resolveVariantEffectiveStock(
      productId,
      options.variantId,
      parentStock,
      data?.manage_stock === false
    );
    return {
      available: currentStock >= requestedQuantity,
      currentStock,
      requestedQuantity,
    };
  }
  const resolved = options?.offerId
    ? await resolveOfferStock(productId, options.offerId, parentStock)
    : await resolveBaseStock(productId, parentStock);
  // Under strict serialized tracking the per-identity total keeps its
  // scalar allocation, but the base line and every sibling offer draw
  // from one shared pool: the aggregate must fit the live units too.
  const aggregateFits =
    resolved.strictUnits === null ||
    options?.aggregateQuantity === undefined ||
    resolved.strictUnits >= options.aggregateQuantity;
  return {
    available: resolved.stock >= requestedQuantity && aggregateFits,
    currentStock: resolved.stock,
    requestedQuantity,
  };
}
