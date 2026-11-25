import type { ShippingQuote } from '@/types/shipping-quote';

type ConfirmedCarrierQuote = {
  id: string;
  cartKey: string;
  merchantId: string;
  conversationId: number;
  expiresAt: number;
  quote: ShippingQuote;
  address: {
    address: string;
    city: string;
    state: string;
    country: 'Nigeria';
    countryCode: 'NG';
    latitude: number;
    longitude: number;
  };
};

// Parent page memory. The widget only receives a short-lived selector and
// cannot set the amount, destination, or provider quote ID for an order.
let current: ConfirmedCarrierQuote | null = null;

export function rememberChatwootCarrierQuote(quote: ConfirmedCarrierQuote) {
  current = quote;
}

export function clearChatwootCarrierQuote() {
  current = null;
}

export function resolveChatwootCarrierQuote(
  scope: Pick<
    ConfirmedCarrierQuote,
    'id' | 'cartKey' | 'merchantId' | 'conversationId'
  >
) {
  if (
    current?.id !== scope.id ||
    current.cartKey !== scope.cartKey ||
    current.merchantId !== scope.merchantId ||
    current.conversationId !== scope.conversationId ||
    current.expiresAt <= Date.now()
  )
    return null;
  return current;
}
