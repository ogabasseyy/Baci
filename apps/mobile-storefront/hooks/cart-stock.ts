import NetInfo from '@react-native-community/netinfo';
import { createLogger } from '@/lib/logger';
import { supabase } from '@/lib/supabase';
import { useCartStore } from '@/stores/cart-store';
import type { CartItem } from '@/stores/cart-store.types';
import { resolveBaseEffectiveStock } from './cart-stock-base';
import { resolveOfferEffectiveStock } from './cart-stock-offers';
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
  // Offer lines still resolve their own allocation: order creation
  // checks the offer scalar even on unmanaged parents.
  if (data?.manage_stock === false && !options?.offerId) {
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
