import { getCartItemEffectivePrice } from '@/lib/cart-pricing';
import type { CartItem } from '@/stores/cart-store';

export interface ShippingQuoteLike {
  id: string | number;
  price: number | string;
  isStationPickup?: boolean;
  provider?: string;
  serviceTier?: string;
}

function isGoFasterQuote(quote: ShippingQuoteLike): boolean {
  return (
    quote.provider?.toUpperCase() === 'GIGL' &&
    quote.serviceTier?.toLowerCase().includes('gofaster') === true
  );
}

function normalizeShippingQuotePrice(value: number | string): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, value);
  }

  if (typeof value === 'string') {
    const cleaned = value.replace(/[^\d.-]/g, '');
    const parsed = Number(cleaned);

    if (Number.isFinite(parsed)) {
      return Math.max(0, parsed);
    }
  }

  return 0;
}

export function normalizeShippingQuotes<T extends ShippingQuoteLike>(
  quotes: T[]
): Array<T & { price: number }> {
  return quotes.map((quote) => ({
    ...quote,
    price: normalizeShippingQuotePrice(quote.price),
  }));
}

function normalizeFragment(value: string): string {
  return value.trim().toLowerCase();
}

function buildShippingQuoteItemKey(item: CartItem): string {
  return JSON.stringify([
    item.product_id ?? '',
    item.variant_id ?? '',
    item.quantity,
    getCartItemEffectivePrice(item),
    item.hasAssurance ? (item.assuranceRate ?? 'default') : '',
  ]);
}

export function buildShippingQuoteContextKey(
  state: string,
  city: string,
  items: CartItem[],
  address = ''
): string {
  if (!state.trim() || !city.trim() || items.length === 0) {
    return '';
  }

  const itemKey = items.map(buildShippingQuoteItemKey).sort().join('|');

  return `${normalizeFragment(state)}::${normalizeFragment(city)}::${normalizeFragment(address)}::${itemKey}`;
}

export function getPreferredShippingQuoteId(
  quotes: ShippingQuoteLike[],
  previousSelectedQuoteId?: string | null
): string {
  if (quotes.length === 0) {
    return '';
  }

  const doorQuotes = quotes.filter(
    (quote) => quote.isStationPickup !== true && !isGoFasterQuote(quote)
  );

  // Never auto-select a station-pickup quote for door delivery. The fee/order
  // builders ignore station quotes for door, so auto-selecting one would let a
  // customer place a door order with no real door quote and a zero shipping fee.
  // With no door quote, return '' so the customer is forced to pick a station.
  if (doorQuotes.length === 0) {
    return '';
  }

  if (
    previousSelectedQuoteId &&
    doorQuotes.some(
      (quote) => String(quote.id) === String(previousSelectedQuoteId)
    )
  ) {
    return String(previousSelectedQuoteId);
  }

  return String(
    doorQuotes.reduce((prev, current) =>
      normalizeShippingQuotePrice(prev.price) <=
      normalizeShippingQuotePrice(current.price)
        ? prev
        : current
    ).id
  );
}
