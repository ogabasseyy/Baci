import { isProductNegotiable } from '@baci/shared/lib';
import type { CartItem } from '@/stores/cart-store';

type CartPriceInput = Pick<
  CartItem,
  'brand' | 'name' | 'negotiatedPrice' | 'negotiationStatus' | 'price'
>;

const isValidCartPrice = (value: number) =>
  Number.isFinite(value) && value >= 0;

export function getCartItemBasePrice(item: CartPriceInput): number {
  return isValidCartPrice(item.price) ? item.price : 0;
}

export function getActiveNegotiatedPrice(
  item: CartPriceInput
): number | undefined {
  if (item.negotiationStatus !== 'accepted') {
    return undefined;
  }

  const basePrice = getCartItemBasePrice(item);
  if (basePrice !== item.price) {
    return undefined;
  }

  if (
    typeof item.negotiatedPrice !== 'number' ||
    !isValidCartPrice(item.negotiatedPrice) ||
    item.negotiatedPrice > basePrice
  ) {
    return undefined;
  }

  if (!isProductNegotiable({ brand: item.brand, name: item.name })) {
    return undefined;
  }

  return item.negotiatedPrice;
}

export function hasActiveNegotiatedPrice(item: CartPriceInput): boolean {
  return getActiveNegotiatedPrice(item) !== undefined;
}

export function getCartItemEffectivePrice(item: CartPriceInput): number {
  return getActiveNegotiatedPrice(item) ?? getCartItemBasePrice(item);
}

/**
 * Fixed assurance rate for the advisory quote subtotal. The order API
 * recomputes assurance server-side at this fixed rate ("never trust the
 * client value"), so the advisory basis must use it too — otherwise a
 * merchant rate tier sitting between the two subtotals would display a
 * rate the order endpoint then rejects.
 */
const QUOTE_ASSURANCE_RATE = 0.05;

function roundQuoteCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Advisory merchant-rate subtotal on the order-verification basis: catalog
 * unit prices plus the same effective-basis assurance fees the order payload
 * carries, matching `computeCanonicalOrderSubtotal` on the server.
 */
export function getCartCatalogSubtotalWithAssurance(
  items: readonly CartItem[]
): number {
  return items.reduce((total, item) => {
    // Zero-priced quiz voucher lines and below-catalog condition-offer
    // lines retain the catalog basis so conditional merchant rates still
    // see the real subtotal.
    const basePrice =
      typeof item.catalog_price === 'number' &&
      isValidCartPrice(item.catalog_price)
        ? item.catalog_price
        : getCartItemBasePrice(item);
    const assuranceFee = item.hasAssurance
      ? roundQuoteCurrency(
          getCartItemEffectivePrice(item) * item.quantity * QUOTE_ASSURANCE_RATE
        )
      : 0;
    return total + basePrice * item.quantity + assuranceFee;
  }, 0);
}
