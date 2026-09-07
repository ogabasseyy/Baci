import { normalizeShippingQuoteResponse } from '@/lib/shipping/quote-response';
import { isCheckoutDeliveryAddressReady } from '../is-checkout-delivery-address-ready';
import type { ShippingQuote } from '../types';
import { getPreferredDoorQuoteId } from '../utils';

export const CHECKOUT_QUOTE_TIMEOUT_MS = 15_000;

interface QuoteCartItem {
  name: string;
  quantity: number;
  price: number;
  negotiatedPrice?: number;
}

interface QuoteReceiver {
  address: string;
  state: string;
  city: string;
  phone: string;
  fName: string;
  lName: string;
  email: string;
  merchantId?: string;
  deliveryPreference: 'door' | 'pickup_station';
  latitude?: number;
  longitude?: number;
  /** Merchant-country display name (e.g. 'Nigeria', 'India') — no longer hardcoded to Nigeria. */
  country: string;
  /** Merchant-country ISO code (e.g. 'NG', 'IN'), drives country-aware merchant zone matching. */
  countryCode: string;
  /**
   * Catalog subtotal (merchant-currency major units) forwarded as `cart_subtotal`
   * so the route can evaluate free-over/price-tier merchant rate conditions.
   */
  cartSubtotal: number;
}

interface QuoteState {
  activeAbortController: { current: AbortController | null };
  currentRequestKey: string;
  force: boolean;
  requestSequence: { current: number };
  setIsLoadingQuotes: (loading: boolean) => void;
  setResolvedQuoteRequestKey: (key: string) => void;
  setSelectedQuoteId: (id: string) => void;
  setShippingQuotes: (quotes: ShippingQuote[]) => void;
}

export function invalidatePendingQuoteRequests(
  requestSequence: { current: number },
  activeAbortController?: { current: AbortController | null }
) {
  activeAbortController?.current?.abort();
  if (activeAbortController) activeAbortController.current = null;
  requestSequence.current += 1;
  return requestSequence.current;
}

function buildQuoteRequestKey(receiver: QuoteReceiver, cart: QuoteCartItem[]) {
  return JSON.stringify({
    address: receiver.address.trim().toLowerCase(),
    city: receiver.city.trim().toLowerCase(),
    deliveryPreference: receiver.deliveryPreference,
    merchantId: receiver.merchantId ?? null,
    items: cart.map((item) => [
      item.name,
      item.quantity,
      item.negotiatedPrice ?? item.price,
    ]),
    state: receiver.state.trim().toLowerCase(),
    latitude: receiver.latitude,
    longitude: receiver.longitude,
    // A catalog-subtotal change (e.g. assurance toggle) can flip merchant
    // free-over/price-tier rates even when the item list is unchanged, so the
    // subtotal is part of the request key to force a re-quote.
    cartSubtotal: receiver.cartSubtotal,
    // A merchant-country change re-quotes because it drives country-aware zone
    // matching (non-NG merchants resolve different zones/rates).
    country: receiver.country,
    countryCode: receiver.countryCode,
  });
}

export async function loadCheckoutShippingQuotes(
  receiver: QuoteReceiver,
  cart: QuoteCartItem[],
  state: QuoteState
) {
  if (!isCheckoutDeliveryAddressReady(receiver)) {
    invalidatePendingQuoteRequests(
      state.requestSequence,
      state.activeAbortController
    );
    clearQuotes(state);
    state.setIsLoadingQuotes(false);
    return;
  }
  const requestKey = buildQuoteRequestKey(receiver, cart);
  if (!state.force && requestKey === state.currentRequestKey) return;
  const requestSequence = invalidatePendingQuoteRequests(
    state.requestSequence,
    state.activeAbortController
  );
  const isLatestRequest = () =>
    state.requestSequence.current === requestSequence;
  const abortController = new AbortController();
  state.activeAbortController.current = abortController;
  let didTimeout = false;
  const timeoutId = setTimeout(() => {
    didTimeout = true;
    abortController.abort();
  }, CHECKOUT_QUOTE_TIMEOUT_MS);

  state.setIsLoadingQuotes(true);
  state.setSelectedQuoteId('');

  try {
    const response = await fetch('/api/shipping/quotes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-baci-client': 'web-storefront',
      },
      body: JSON.stringify({
        deliveryPreference: receiver.deliveryPreference,
        merchantId: receiver.merchantId || undefined,
        receiver: {
          name:
            `${receiver.fName} ${receiver.lName}`.trim() || 'Valued Customer',
          email: receiver.email || 'guest@example.com',
          phone: receiver.phone || '',
          address: receiver.address,
          city: receiver.city,
          state: receiver.state,
          // Country is derived from the merchant (not hardcoded Nigeria) so a
          // non-NG merchant quotes against its own country-aware zones/rates.
          country: receiver.country,
          countryCode: receiver.countryCode,
          ...(Number.isFinite(receiver.latitude) &&
          Number.isFinite(receiver.longitude)
            ? {
                latitude: receiver.latitude,
                longitude: receiver.longitude,
              }
            : {}),
        },
        items: cart.map((item) => ({
          name: item.name,
          quantity: item.quantity,
          weight: 1,
          value: item.negotiatedPrice ?? item.price,
        })),
        // Catalog subtotal lets the route evaluate merchant free-over /
        // price-tier rate conditions at quote time (advisory; order creation
        // re-derives the fee server-side).
        cart_subtotal: receiver.cartSubtotal,
        // Opt-in: this client can thread a merchant rate's synthetic
        // `mrate_<uuid>` id back as `shipping_rate_id`, so the route may return
        // (otherwise gated) merchant-configured rates.
        supports_merchant_rates: true,
      }),
      signal: abortController.signal,
    });

    if (response.ok) {
      const data: unknown = await response.json();
      if (!isLatestRequest()) return;
      const { quotes } = normalizeShippingQuoteResponse(data);
      state.setShippingQuotes(quotes);
      state.setResolvedQuoteRequestKey(requestKey);
      const preferredQuoteId =
        receiver.deliveryPreference === 'pickup_station'
          ? quotes.find((quote) => quote.isStationPickup)?.id
          : getPreferredDoorQuoteId(quotes);
      if (preferredQuoteId) state.setSelectedQuoteId(String(preferredQuoteId));
    } else {
      console.warn('Failed to fetch quotes:', await response.text());
      if (isLatestRequest()) clearQuotes(state);
    }
  } catch (error) {
    const isAbortError =
      error instanceof DOMException && error.name === 'AbortError';
    if (abortController.signal.aborted && !isLatestRequest()) return;
    if (didTimeout) {
      console.warn('Shipping quote request timed out');
    } else if (isAbortError) {
      return;
    } else {
      console.error('Error fetching shipping quotes:', error);
    }
    if (isLatestRequest()) clearQuotes(state);
  } finally {
    clearTimeout(timeoutId);
    if (state.activeAbortController.current === abortController) {
      state.activeAbortController.current = null;
    }
    if (isLatestRequest()) state.setIsLoadingQuotes(false);
  }
}

function clearQuotes(state: QuoteState) {
  state.setShippingQuotes([]);
  state.setResolvedQuoteRequestKey('');
  state.setSelectedQuoteId('');
}
