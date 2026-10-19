import type { Product } from '@/lib/products';
import type { CartItem } from './cart-types';

type StrictPoolProductLike = Pick<
  Product,
  'inventory_tracking_policy' | 'stock_quantity'
>;

export interface SimpleLineAddCaps {
  cappedOfferAllocation: number | undefined;
  strictPool: number | undefined;
}

/**
 * Add-path caps for a simple base/offer line: the offer's own allocation
 * plus the shared strict base-unit pool (sibling offer lines aggregate
 * against it, mirroring order creation). The offer identity travels on
 * the add options (merging matches it), so the same caps cover fresh and
 * merged adds. Variant adds resolve their own units and voucher lines
 * redeem pre-reserved units, so both skip the pool.
 */
export function resolveSimpleLineAddCaps({
  product,
  isVoucherLine,
  variantId,
  offerId,
  stock,
}: {
  product: StrictPoolProductLike;
  isVoucherLine: boolean;
  variantId: string | null | undefined;
  offerId: string | null | undefined;
  stock: number | null | undefined;
}): SimpleLineAddCaps {
  return {
    cappedOfferAllocation: resolveCappedOfferAllocation({
      isVoucherLine,
      offerId,
      stock,
    }),
    strictPool:
      !isVoucherLine && variantId == null
        ? getStrictSerializedPool(product)
        : undefined,
  };
}

/**
 * Desired add quantity through the add-path caps: the offer allocation
 * first, then strict-pool headroom outside the excluded sibling. Zero
 * through either gate keeps the previous cart (validation prunes dead
 * lines) instead of adding a zero-quantity line.
 */
export function capAddedSimpleLineQuantity({
  caps,
  cart,
  productId,
  excludeIndex = -1,
  quantity,
}: {
  caps: SimpleLineAddCaps;
  cart: CartItem[];
  productId: string;
  excludeIndex?: number;
  quantity: number;
}): { quantity: number } | { keepPrevious: true } {
  const offerCapped =
    caps.cappedOfferAllocation !== undefined
      ? Math.min(quantity, caps.cappedOfferAllocation)
      : quantity;
  if (caps.cappedOfferAllocation !== undefined && offerCapped <= 0) {
    return { keepPrevious: true };
  }
  const poolCapped = capQuantityToStrictPool({
    strictPool: caps.strictPool,
    cart,
    productId,
    excludeIndex,
    quantity: offerCapped,
  });
  if (caps.strictPool !== undefined && poolCapped <= 0) {
    return { keepPrevious: true };
  }
  return { quantity: poolCapped };
}

/**
 * Update-path caps (same rules as adds): the offer allocation, then
 * strict-pool headroom outside this line. Variant and voucher lines
 * skip the pool aggregate, same as adds. A zero allocation or zero
 * headroom keeps the previous quantity instead of deleting the line;
 * validation prunes dead lines.
 */
export function capUpdatedSimpleLineQuantity({
  item,
  cart,
  excludeIndex,
  quantity,
}: {
  item: CartItem;
  cart: CartItem[];
  excludeIndex: number;
  quantity: number;
}): { quantity: number } | { keepPrevious: true } {
  const allocationCap = applyOfferAllocationCap({
    offerId: item.offerId,
    stock: item.stock,
    quantity,
  });
  if (allocationCap && 'keepPrevious' in allocationCap) {
    return { keepPrevious: true };
  }
  const desired = allocationCap ? allocationCap.quantity : quantity;
  if (
    item.variantId == null &&
    item.quizAwardId == null &&
    item.quizVoucherToken == null
  ) {
    const strictPool = getStrictSerializedPool(item);
    if (strictPool !== undefined) {
      const poolCapped = capQuantityToStrictPool({
        strictPool,
        cart,
        productId: item.id,
        excludeIndex,
        quantity: desired,
      });
      if (poolCapped <= 0) {
        return { keepPrevious: true };
      }
      return { quantity: poolCapped };
    }
  }
  return { quantity: desired };
}

/**
 * Shared base-unit pool for a strict serialized product. Hydration folds
 * exact units into stock_quantity while each offer add carries its own
 * allocation on stock, so sibling offer lines must aggregate against
 * this pool — not just their own scalar — mirroring the native
 * getExistingProductQuantityForStock check. Non-strict, unmanaged, and
 * non-finite shapes return undefined so callers keep scalar logic.
 */
export function getStrictSerializedPool(
  product: StrictPoolProductLike
): number | undefined {
  if (product.inventory_tracking_policy !== 'serialized_strict') {
    return undefined;
  }
  if (
    typeof product.stock_quantity !== 'number' ||
    !Number.isFinite(product.stock_quantity) ||
    product.stock_quantity < 0
  ) {
    return undefined;
  }
  return Math.floor(product.stock_quantity);
}

/**
 * Units already in the cart for a simple (non-variant) product across
 * the base line and every sibling offer line. Voucher lines redeem
 * pre-reserved award units outside the shared pool, so they are
 * excluded from both the sum and the cap.
 */
export function getSimpleProductCartTotal(
  cart: CartItem[],
  productId: string,
  excludeIndex = -1
): number {
  return cart.reduce(
    (total, line, index) =>
      index !== excludeIndex &&
      line.id === productId &&
      line.variantId == null &&
      line.quizAwardId == null &&
      line.quizVoucherToken == null
        ? total + line.quantity
        : total,
    0
  );
}

/**
 * Add-path offer cap. Offer lines carry their selected allocation on
 * stock (unlimited offers carry a 9999 sentinel): cap the resulting
 * line at it so two successive adds cannot exceed what checkout will
 * reserve. Only voucher and non-finite-allocation lines skip the cap:
 * order creation enforces finite offer scalars even on unmanaged
 * parents (M24), so unmanaged offer lines keep the cap exactly like
 * managed ones. Returns undefined when no cap applies.
 */
export function resolveCappedOfferAllocation({
  isVoucherLine,
  offerId,
  stock,
}: {
  isVoucherLine: boolean;
  offerId: string | null | undefined;
  stock: number | null | undefined;
}): number | undefined {
  if (isVoucherLine || offerId == null) {
    return undefined;
  }
  if (typeof stock !== 'number' || !Number.isFinite(stock) || stock < 0) {
    return undefined;
  }
  return Math.floor(stock);
}

/**
 * Update-path offer cap (same rule as adds: silent over-quantity
 * updates would otherwise sail past checkout reservation). A zero
 * allocation keeps the previous quantity instead of deleting the
 * line; validation prunes dead lines. Returns null when no cap
 * applies.
 */
export function applyOfferAllocationCap({
  offerId,
  stock,
  quantity,
}: {
  offerId: string | null | undefined;
  stock: number | null | undefined;
  quantity: number;
}): { quantity: number } | { keepPrevious: true } | null {
  if (offerId == null || typeof stock !== 'number' || !Number.isFinite(stock)) {
    return null;
  }
  const allocation = Math.floor(stock);
  if (allocation <= 0) {
    return { keepPrevious: true };
  }
  return { quantity: Math.min(quantity, allocation) };
}

/**
 * Strict-pool headroom cap for simple base/offer lines: the line may
 * only take what remains of the shared base-unit pool outside the
 * excluded sibling line. Without this aggregate, the cart could hold
 * two units against a single available unit that order creation then
 * rejects on the second line. Returns the capped quantity (0 when no
 * headroom remains); a undefined pool leaves the quantity untouched.
 */
export function capQuantityToStrictPool({
  strictPool,
  cart,
  productId,
  excludeIndex = -1,
  quantity,
}: {
  strictPool: number | undefined;
  cart: CartItem[];
  productId: string;
  excludeIndex?: number;
  quantity: number;
}): number {
  if (strictPool === undefined) {
    return quantity;
  }
  return Math.min(
    quantity,
    Math.max(
      0,
      strictPool - getSimpleProductCartTotal(cart, productId, excludeIndex)
    )
  );
}
