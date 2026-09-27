import type { CartItem } from '@/hooks/cart';
import { DEFAULT_ASSURANCE_RATE } from '@/lib/checkout/constants';

function roundCurrencyToCents(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Strips negotiation-related fields from cart items if the merchant is not entitled to price negotiation.
 */
export function sanitizeCartItems(
  cart: CartItem[],
  hasPriceNegotiation: boolean
): CartItem[] {
  return cart.map((item) => {
    if (!hasPriceNegotiation) {
      return {
        ...item,
        negotiatedPrice: undefined,
        negotiationStatus: undefined,
        cartDiscount: undefined,
      };
    }
    return item;
  });
}

/**
 * Calculates the total of the cart, taking into account negotiated price (if entitled) and quantity-aware assurance fees.
 */
export function isQuizVoucherCartItem(item: CartItem): boolean {
  return Boolean(item.quizAwardId && item.quizVoucherToken);
}

export function getCartItemCheckoutUnitPrice(item: CartItem): number {
  if (isQuizVoucherCartItem(item)) {
    return 0;
  }

  const rawPrice = item.negotiatedPrice ?? item.price;
  return typeof rawPrice === 'number' && !Number.isNaN(rawPrice) ? rawPrice : 0;
}

export function calculateCartItemSubtotal(
  cart: CartItem[],
  hasPriceNegotiation: boolean
): number {
  const sanitizedCart = sanitizeCartItems(cart, hasPriceNegotiation);
  return sanitizedCart.reduce((total, item) => {
    const price = getCartItemCheckoutUnitPrice(item);
    const quantity =
      typeof item.quantity === 'number' && !Number.isNaN(item.quantity)
        ? item.quantity
        : 0;
    return total + price * quantity;
  }, 0);
}

export function calculateCartTotal(
  cart: CartItem[],
  hasPriceNegotiation: boolean
): number {
  const sanitizedCart = sanitizeCartItems(cart, hasPriceNegotiation);
  return sanitizedCart.reduce((total, item) => {
    const price = getCartItemCheckoutUnitPrice(item);
    const quantity =
      typeof item.quantity === 'number' && !Number.isNaN(item.quantity)
        ? item.quantity
        : 0;
    const itemTotal = price * quantity;
    const assuranceCost = item.hasAssurance
      ? itemTotal * (item.assuranceRate ?? DEFAULT_ASSURANCE_RATE)
      : 0;
    return total + itemTotal + assuranceCost;
  }, 0);
}

/**
 * Catalog (pre-negotiation) cart subtotal that mirrors the server's
 * `computeCanonicalOrderSubtotal`. The order-time merchant shipping-rate fee
 * guard verifies free-over / price-tier thresholds against that CANONICAL
 * subtotal, which prices goods at the catalog unit price (`products.price` /
 * `variant.price_override`) rather than the negotiated line price. Quoting with
 * the negotiated `calculateCartTotal` could straddle a threshold and make the
 * order-time recompute disagree with the fee the customer saw — a fail-closed
 * 400 for a legitimate checkout. Sending this basis keeps them aligned.
 *
 * Only the GOODS basis differs from `calculateCartTotal`: goods use the catalog
 * `item.price` (which already reflects any selected variant's override), or
 * the retained `item.catalogPrice` for condition-offer lines priced below
 * catalog, while the quantity-aware assurance fee stays on the negotiated
 * checkout unit price exactly as the server recomputes it (`assurance_fee`
 * derives from the negotiated line price in `/api/orders`).
 *
 * Residual divergences vs. the server — all advisory, since the server always
 * re-derives the authoritative fee at order time:
 *  - quiz-voucher items are priced at their cart `item.price`; if that is
 *    zeroed on the client they under-count relative to the DB catalog price.
 */
export function calculateCartCatalogSubtotal(
  cart: CartItem[],
  hasPriceNegotiation: boolean
): number {
  const sanitizedCart = sanitizeCartItems(cart, hasPriceNegotiation);
  return sanitizedCart.reduce((total, item) => {
    const quantity =
      typeof item.quantity === 'number' && !Number.isNaN(item.quantity)
        ? item.quantity
        : 0;
    // Condition-offer lines price below catalog; prefer the retained catalog
    // basis so merchant-rate tiers match the server's canonical subtotal.
    const catalogUnitPrice =
      typeof item.catalogPrice === 'number' &&
      Number.isFinite(item.catalogPrice) &&
      item.catalogPrice >= 0
        ? item.catalogPrice
        : typeof item.price === 'number' && !Number.isNaN(item.price)
          ? item.price
          : 0;
    const goodsTotal = catalogUnitPrice * quantity;
    // Assurance fee tracks the negotiated line price (mirrors the server's
    // `assurance_fee` basis), not the catalog price used for goods above.
    // The rate is pinned to the server-authoritative default and rounded per
    // line, exactly as `/api/orders` recomputes it — never the item's own
    // `assuranceRate`.
    const assuranceBasis = getCartItemCheckoutUnitPrice(item) * quantity;
    const assuranceCost = item.hasAssurance
      ? roundCurrencyToCents(assuranceBasis * DEFAULT_ASSURANCE_RATE)
      : 0;
    return total + goodsTotal + assuranceCost;
  }, 0);
}
