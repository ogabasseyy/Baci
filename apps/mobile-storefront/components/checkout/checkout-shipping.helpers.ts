import {
  filterByLocationPhrase,
  resolveLocationStateLabel,
} from '@baci/shared/lib';
import {
  getCartCatalogSubtotalWithAssurance,
  getCartItemEffectivePrice,
} from '@/lib/cart-pricing';
import { CONFIG } from '@/lib/config';
import {
  getPreferredShippingQuoteId,
  normalizeShippingQuotes,
} from '@/lib/shipping-quotes';
import type { CartItem } from '@/stores/cart-store';
import { CHECKOUT_MERCHANT_ID } from './checkout-screen.constants';
import type { ShippingQuote, ShippingQuoteDeliveryPreference } from './types';

function getQuoteMerchantId(): string | undefined {
  const configuredMerchantId =
    typeof CONFIG.MERCHANT_ID === 'string' ? CONFIG.MERCHANT_ID.trim() : '';
  return configuredMerchantId || CHECKOUT_MERCHANT_ID || undefined;
}

export interface QuoteResponse {
  quotes: {
    all: ShippingQuote[];
  };
}

export interface ShippingLocation {
  city: string;
  state: string;
}

export type FetchQuotesArgs = {
  apiUrl: string;
  state: string;
  city: string;
  latitude?: number;
  longitude?: number;
  items: CartItem[];
  customer: { email?: string } | null;
  watchedFirstName: string;
  watchedLastName: string;
  watchedPhone: string;
  watchedAddress: string;
  watchedEmail: string;
  deliveryPreference?: ShippingQuoteDeliveryPreference;
  setIsLoadingQuotes: (value: boolean) => void;
  setSelectedQuoteId: (value: string) => void;
  setResolvedShippingQuoteContextKey: (value: string) => void;
  setShippingQuotes: (value: ShippingQuote[]) => void;
  previousSelectedQuoteId?: string | null;
  quoteContextKey: string;
  shouldResetSelection: boolean;
  signal?: AbortSignal;
};

export function normalizeStateName(
  googleState: string,
  knownStates: string[]
): string {
  return resolveLocationStateLabel(googleState, knownStates);
}

export type GoogleCitySuggestionAction =
  | { type: 'none' }
  | { type: 'openPicker' }
  | { type: 'selectCity'; city: string }
  | { type: 'seedSearch'; city: string };

export function resolveGoogleCitySuggestionAction(
  cities: string[],
  suggestedCity: string | null
): GoogleCitySuggestionAction {
  if (cities.length === 0 || suggestedCity === null) {
    return { type: 'none' };
  }

  if (suggestedCity === '') {
    return { type: 'openPicker' };
  }

  const match = cities.find(
    (city) => city.toLowerCase() === suggestedCity.toLowerCase()
  );

  return match
    ? { type: 'selectCity', city: match }
    : { type: 'seedSearch', city: suggestedCity };
}

function getPreferredQuoteIdForPreference(
  quotes: ShippingQuote[],
  deliveryPreference: ShippingQuoteDeliveryPreference,
  previousSelectedQuoteId?: string | null
): string {
  if (deliveryPreference === 'door') {
    return getPreferredShippingQuoteId(quotes, previousSelectedQuoteId);
  }

  if (quotes.length === 0) return '';

  if (
    previousSelectedQuoteId &&
    quotes.some((quote) => String(quote.id) === String(previousSelectedQuoteId))
  ) {
    return String(previousSelectedQuoteId);
  }

  return String(
    quotes.reduce((prev, current) =>
      prev.price <= current.price ? prev : current
    ).id
  );
}

function filterPickupQuotesByCity(
  quotes: ShippingQuote[],
  city: string,
  state: string
): ShippingQuote[] {
  return filterByLocationPhrase(
    quotes,
    city,
    state,
    (quote) =>
      `${quote.stationName ?? ''} ${quote.stationAddress ?? ''} ${quote.displayName}`
  );
}

export const fetchShippingQuotes = async ({
  apiUrl,
  state,
  city,
  latitude,
  longitude,
  items,
  customer,
  watchedFirstName,
  watchedLastName,
  watchedPhone,
  watchedAddress,
  watchedEmail,
  deliveryPreference = 'door',
  setIsLoadingQuotes,
  setSelectedQuoteId,
  setResolvedShippingQuoteContextKey,
  setShippingQuotes,
  previousSelectedQuoteId,
  quoteContextKey,
  shouldResetSelection,
  signal,
}: FetchQuotesArgs) => {
  if (!state || !city || items.length === 0) return;

  setIsLoadingQuotes(true);
  if (shouldResetSelection) {
    setShippingQuotes([]);
    setSelectedQuoteId('');
    setResolvedShippingQuoteContextKey('');
  }

  try {
    const merchantId = getQuoteMerchantId();
    const response = await fetch(`${apiUrl}/api/shipping/quotes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Baci-Client': 'mobile-storefront',
      },
      body: JSON.stringify({
        ...(merchantId ? { merchantId } : {}),
        deliveryPreference,
        supports_merchant_rates: true,
        cart_subtotal: getCartCatalogSubtotalWithAssurance(items),
        receiver: {
          name:
            `${watchedFirstName} ${watchedLastName}`.trim() ||
            'Valued Customer',
          email: customer?.email || watchedEmail || 'guest@example.com',
          phone: watchedPhone || '',
          address: watchedAddress || `${city}, ${state}`,
          city,
          state,
          country: 'Nigeria',
          ...(Number.isFinite(latitude) && Number.isFinite(longitude)
            ? { latitude, longitude }
            : {}),
        },
        items: items.map((item) => ({
          name: item.name,
          quantity: item.quantity,
          value: getCartItemEffectivePrice(item),
          // Cart lines do not currently persist package weight; backend quotes
          // expect a numeric value, so we keep the existing conservative default.
          weight: 1,
        })),
      }),
      signal,
    });

    if (signal?.aborted) return;

    if (response.ok) {
      const data: QuoteResponse & { warnings?: string[] } =
        await response.json();
      const quotes = normalizeShippingQuotes(data.quotes?.all || []);
      const stationPickupQuotes =
        deliveryPreference === 'pickup_station'
          ? quotes.filter((quote) => quote.isStationPickup === true)
          : quotes;
      // City filtering applies to carrier stations only: merchant pickup
      // rates were already matched to the destination zone by the backend,
      // so a carrier match must not remove them from the selectable list.
      const carrierStationQuotes = stationPickupQuotes.filter(
        (quote) => quote.provider !== 'MERCHANT'
      );
      const merchantPickupQuotes = stationPickupQuotes.filter(
        (quote) => quote.provider === 'MERCHANT'
      );
      const selectableQuotes =
        deliveryPreference === 'pickup_station'
          ? [
              ...filterPickupQuotesByCity(carrierStationQuotes, city, state),
              ...merchantPickupQuotes,
            ]
          : stationPickupQuotes;
      setShippingQuotes(selectableQuotes);
      setResolvedShippingQuoteContextKey(quoteContextKey);
      setSelectedQuoteId(
        getPreferredQuoteIdForPreference(
          selectableQuotes,
          deliveryPreference,
          previousSelectedQuoteId
        )
      );
    } else if (shouldResetSelection) {
      setShippingQuotes([]);
      setSelectedQuoteId('');
      setResolvedShippingQuoteContextKey('');
    }
  } catch (_error) {
    if (signal?.aborted) return;
    if (shouldResetSelection) {
      setShippingQuotes([]);
      setSelectedQuoteId('');
      setResolvedShippingQuoteContextKey('');
    }
  } finally {
    if (!signal?.aborted) {
      setIsLoadingQuotes(false);
    }
  }
};
