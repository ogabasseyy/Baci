import NetInfo from '@react-native-community/netinfo';
import { createLogger } from '@/lib/logger';
import { supabase } from '@/lib/supabase';
import { useCartStore } from '@/stores/cart-store';
import type { CartItem } from '@/stores/cart-store.types';

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
  return useCartStore
    .getState()
    .items.reduce(
      (total, cartItem) =>
        cartItem.product_id === item.product_id &&
        (cartItem.variant_id ?? null) === variantId
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
 * @param options.variantId - Selected option identity. A managed option
 *   validates its own effective stock instead of the parent total, so a
 *   stocked variant on a zero-stock parent stays purchasable.
 */
export async function checkStock(
  productId: string,
  requestedQuantity: number,
  cachedStock?: number,
  options?: { variantId?: string | null }
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

  const currentStock = options?.variantId
    ? await resolveVariantEffectiveStock(options.variantId, parentStock)
    : parentStock;
  return {
    available: currentStock >= requestedQuantity,
    currentStock,
    requestedQuantity,
  };
}

/**
 * Option-level effective stock, mirroring the price-options CTE: a finite
 * variant quantity wins, a null one inherits the parent stock, and
 * serialized tracking bypasses the quantity check. A vanished variant
 * reports zero since the selected option cannot be fulfilled; other
 * lookup failures throw so the caller retries instead of overselling.
 */
async function resolveVariantEffectiveStock(
  variantId: string,
  parentStock: number
): Promise<number> {
  const { data, error } = await supabase
    .from('product_variants')
    .select('stock_quantity, inventory_tracking_policy')
    .eq('id', variantId)
    .single();
  if (error || !data) {
    if (error?.code === 'PGRST116' || !error) {
      log.error('Variant stock check found no such variant:', variantId);
      return 0;
    }
    log.error('Variant stock check failed:', error);
    throw new Error('Cannot verify stock availability. Please try again.');
  }
  if (
    data.inventory_tracking_policy === 'serialized_only' ||
    data.inventory_tracking_policy === 'serialized_then_unlimited'
  ) {
    return Number.MAX_SAFE_INTEGER;
  }
  return typeof data.stock_quantity === 'number' &&
    Number.isFinite(data.stock_quantity)
    ? data.stock_quantity
    : parentStock;
}
