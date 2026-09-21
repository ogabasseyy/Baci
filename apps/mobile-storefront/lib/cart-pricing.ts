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
 * Advisory merchant-rate subtotal on the order-verification basis: catalog
 * unit prices plus the same effective-basis assurance fees the order payload
 * carries, matching `computeCanonicalOrderSubtotal` on the server.
 */
export function getCartCatalogSubtotalWithAssurance(
  items: readonly CartItem[]
): number {
  return items.reduce((total, item) => {
    const basePrice = getCartItemBasePrice(item);
    const assuranceFee = item.hasAssurance
      ? Math.round(
          getCartItemEffectivePrice(item) *
            item.quantity *
            (item.assuranceRate ?? 0.05)
        )
      : 0;
    return total + basePrice * item.quantity + assuranceFee;
  }, 0);
}
