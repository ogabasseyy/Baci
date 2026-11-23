import { getMerchantRateId } from '@/components/storefront/ogabassey/pages/checkout/get-merchant-rate-id';
import { prepareCheckoutDelivery } from '@/components/storefront/ogabassey/pages/checkout/handlers/prepare-checkout-delivery';
import { loadCheckoutShippingQuotes } from '@/components/storefront/ogabassey/pages/checkout/hooks/checkout-shipping-quote-loader';
import { isMerchantQuote } from '@/components/storefront/ogabassey/pages/checkout/is-merchant-quote';
import type { DeliveryMethod } from '@/components/storefront/ogabassey/pages/checkout/types';
import { formatChatwootPickupLocation } from '@/lib/chatwoot/pickup-location';
import type { ShippingQuote } from '@/types/shipping-quote';
import type { ChatwootCheckoutFailureCode } from './chatwoot-checkout-result';
import { resolveChatwootCheckoutState } from './chatwoot-checkout-state';

export interface ChatwootCheckoutDeliveryInput {
  merchantId: string;
  customer: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
  };
  address: { line1: string; city: string; state: string };
  /** The option the widget showed, as projected by the delivery-options route. */
  choice: {
    displayName: string;
    priceMajor: number;
    pickup: boolean;
    /** Required to tell apart pickup rates that share a name and price. */
    pickupLocation?: string;
  };
  quoteItems: {
    name: string;
    quantity: number;
    price: number;
    negotiatedPrice?: number;
  }[];
  /** The cart subtotal (major units) the shown options were quoted on. */
  cartSubtotal: number;
}

export type ChatwootCheckoutDeliveryResult =
  | {
      ok: true;
      method: Extract<DeliveryMethod, 'door' | 'pickup_station'>;
      quote: ShippingQuote;
      merchantRateId: string | null;
      carrier?: 'GIGL';
      address: ReturnType<typeof prepareCheckoutDelivery>['address'] & {
        latitude?: number;
        longitude?: number;
      };
    }
  | { ok: false; code: ChatwootCheckoutFailureCode };

const toMinor = (major: number) => Math.round(major * 100);

async function loadMerchantQuotes(
  input: ChatwootCheckoutDeliveryInput,
  state: string
): Promise<ShippingQuote[]> {
  let quotes: ShippingQuote[] = [];
  const { customer, address } = input;
  await loadCheckoutShippingQuotes(
    {
      address: address.line1,
      city: address.city,
      state,
      phone: customer.phone,
      fName: customer.firstName,
      lName: customer.lastName,
      email: customer.email,
      merchantId: input.merchantId,
      // Ask for what the shopper chose, and for merchant rates only: the chat
      // offers nothing else, so no carrier is queried.
      deliveryPreference: input.choice.pickup ? 'pickup_station' : 'door',
      merchantRatesOnly: true,
      country: 'Nigeria',
      countryCode: 'NG',
      cartSubtotal: input.cartSubtotal,
    },
    input.quoteItems,
    {
      activeAbortController: { current: null },
      currentRequestKey: '',
      force: true,
      requestSequence: { current: 0 },
      setIsLoadingQuotes: () => undefined,
      setResolvedQuoteRequestKey: () => undefined,
      setSelectedQuoteId: () => undefined,
      setShippingQuotes: (next) => {
        quotes = next;
      },
    }
  );
  return quotes;
}

/**
 * Re-quotes the address with the same loader the store checkout uses, then
 * matches the option the widget displayed to exactly one merchant-rate quote.
 * Rate ids never reach the widget, so name, price and pickup flag are the key;
 * zero or several matches fail closed instead of guessing a rate.
 */
export async function resolveChatwootCheckoutDelivery(
  input: ChatwootCheckoutDeliveryInput
): Promise<ChatwootCheckoutDeliveryResult> {
  const state = resolveChatwootCheckoutState(input.address.state);
  if (!state) return { ok: false, code: 'details_invalid' };

  const quotes = await loadMerchantQuotes(input, state);
  const wantedName = input.choice.displayName.trim();
  const candidates = quotes.filter(
    (quote) =>
      isMerchantQuote(quote) &&
      getMerchantRateId(String(quote.id)) !== null &&
      // Chat checkout is naira-only; a rate in another currency never matches.
      String(quote.currency).trim().toUpperCase() === 'NGN' &&
      quote.displayName.trim().slice(0, 120) === wantedName &&
      (quote.isStationPickup === true) === input.choice.pickup &&
      toMinor(quote.price) === toMinor(input.choice.priceMajor)
  );
  // The pickup location tells same-name, same-price pickup rates apart. It
  // is not needed when only one rate fits, but a location the widget did send
  // must still be that rate's.
  const { pickupLocation } = input.choice;
  const matches =
    input.choice.pickup &&
    (candidates.length > 1 || pickupLocation !== undefined)
      ? candidates.filter(
          (quote) => formatChatwootPickupLocation(quote) === pickupLocation
        )
      : candidates;
  const [quote] = matches;
  if (matches.length !== 1 || !quote) {
    return { ok: false, code: 'delivery_unavailable' };
  }

  const method = input.choice.pickup ? 'pickup_station' : 'door';
  const prepared = prepareCheckoutDelivery({
    method,
    selectedQuoteId: String(quote.id),
    selectedQuoteMatchesMethod: true,
    airportRequiresQuote: false,
    quotes,
    isNewAddressMode: true,
    newAddressStreet: input.address.line1,
    newAddressCity: input.address.city,
    newAddressState: state,
    airportType: 'delivery',
    customerPhone: input.customer.phone,
    merchantCountry: 'NG',
  });
  if (prepared.issue || !prepared.merchantRateId) {
    return {
      ok: false,
      code:
        prepared.issue === 'incomplete-address'
          ? 'details_invalid'
          : 'delivery_unavailable',
    };
  }
  return {
    ok: true,
    method,
    quote,
    merchantRateId: prepared.merchantRateId,
    address: prepared.address,
  };
}
