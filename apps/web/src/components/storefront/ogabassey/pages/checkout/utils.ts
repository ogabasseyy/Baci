import { getCountryByCode } from '@/lib/countries';
import { MERCHANT_RATE_ID_PREFIX } from '@/lib/shipping/merchant-rates/to-shipping-quotes';
import { MERCHANT_PROVIDER_CODE } from '@/lib/shipping/types';
import type {
  CryptoChain,
  CryptoCurrency,
  DeliveryMethod,
  ShippingQuote,
} from './types';
import { isGiglGoFasterQuote } from './is-gigl-go-faster-quote';
import { isStationPickupQuote } from './is-station-pickup-quote';

export {
  calculateDeliveryCost,
} from './calculate-delivery-cost';
export { isGiglGoFasterQuote } from './is-gigl-go-faster-quote';
export { isStationPickupQuote } from './is-station-pickup-quote';

/** Date range string for door delivery (tomorrow to +3 days). */
export function getDeliveryDateRange(): string {
  const today = new Date();
  const start = new Date(today);
  start.setDate(today.getDate() + 1);
  const end = new Date(today);
  end.setDate(today.getDate() + 3);

  const options: Intl.DateTimeFormatOptions = {
    day: 'numeric',
    month: 'short',
  };
  return `${start.toLocaleDateString('en-GB', options)} to ${end.toLocaleDateString('en-GB', options)}`;
}

/** Which chains each stablecoin supports. */
export const CRYPTO_CHAIN_SUPPORT: Record<CryptoCurrency, CryptoChain[]> = {
  USDT: ['TRX', 'ETH', 'MATIC', 'AVAXC'],
  USDC: ['ETH', 'MATIC', 'AVAXC'],
};

/** Human-readable chain names. */
export const CHAIN_DISPLAY_NAMES: Record<string, string> = {
  TRX: 'Tron (TRC-20)',
  ETH: 'Ethereum (ERC-20)',
  MATIC: 'Polygon',
  AVAXC: 'Avalanche C-Chain',
};

/** Block explorer address URLs per chain. */
export const CHAIN_EXPLORER_URLS: Record<string, string> = {
  TRX: 'https://tronscan.org/#/address/',
  ETH: 'https://etherscan.io/address/',
  MATIC: 'https://polygonscan.com/address/',
  AVAXC: 'https://snowtrace.io/address/',
};

interface InferredAddressLocation {
  city: string;
  state: string;
}

/**
 * Country NAME/ISO-2 tokens stripped from the tail of a typed address before
 * the final segment is treated as the state. Covers every market that ships a
 * subdivision vocabulary (NG/IN/AE): a self-country or cross-market suffix like
 * "..., Maharashtra, India" must resolve to the subdivision ("Maharashtra"),
 * not treat the country ("India") as the state. Tokens are compared after
 * `normalizeCountryMatchToken` (lowercase, punctuation-collapsed, whitespace
 * removed), so the dotted acronym "U.A.E." and the compact "UAE" both collapse
 * to "uae" and match. The NG entries are unchanged, so NG parsing stays
 * byte-identical; the current merchant country is folded in per-call via
 * `getCountryByCode` so country-level markets (e.g. a trailing "Ghana") also
 * get stripped.
 */
const SUPPORTED_MARKET_COUNTRY_TOKENS: readonly string[] = [
  'NG',
  'Nigeria',
  'IN',
  'India',
  'AE',
  'UAE',
  'United Arab Emirates',
];
const ABUJA_STATE_ALIASES = new Set([
  'abuja',
  'fct',
  'fct abuja',
  'federal capital territory',
  'federal capital territory abuja',
]);

function normalizeStateToken(value: string): string {
  return value.replace(/\s+state$/i, '').trim().toLowerCase();
}

function normalizeStateMatchToken(value: string): string {
  return normalizeStateToken(value).replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Country-token form: the state-match token with ALL interior whitespace
 * removed, so acronyms written with separators collapse onto their compact
 * form ("U.A.E." and "UAE" both become "uae"). Used ONLY for country-suffix
 * stripping — NEVER for state-name matching, where multi-word subdivisions like
 * "West Bengal"/"Cross River" must stay space-separated (`west bengal` /
 * `cross river`) and must not collapse to `westbengal`/`crossriver`.
 */
function normalizeCountryMatchToken(value: string): string {
  return normalizeStateMatchToken(value).replace(/\s+/g, '');
}

function isAbujaAlias(value: string): boolean {
  return ABUJA_STATE_ALIASES.has(normalizeStateMatchToken(value));
}

function statesMatch(candidate: string, input: string): boolean {
  const normalizedCandidate = normalizeStateMatchToken(candidate);
  const normalizedInput = normalizeStateMatchToken(input);

  if (!normalizedCandidate || !normalizedInput) {
    return false;
  }

  if (normalizedCandidate === normalizedInput) {
    return true;
  }

  return isAbujaAlias(normalizedCandidate) && isAbujaAlias(normalizedInput);
}

/**
 * Normalized country-token set for the current market: the supported-market
 * baseline (NG/IN/AE) plus the resolved merchant country's own name and ISO-2
 * code. Resolving `merchantCountry` keeps the parser country-aware for
 * country-level markets whose name/code is not in the baseline.
 */
function buildCountryLocationTokens(merchantCountry?: string): Set<string> {
  const tokens = new Set<string>();
  for (const token of SUPPORTED_MARKET_COUNTRY_TOKENS) {
    tokens.add(normalizeCountryMatchToken(token));
  }

  const country = merchantCountry ? getCountryByCode(merchantCountry) : undefined;
  if (country) {
    tokens.add(normalizeCountryMatchToken(country.code));
    tokens.add(normalizeCountryMatchToken(country.name));
  }

  return tokens;
}

function stripTrailingCountryTokens(
  parts: string[],
  countryTokens: Set<string>,
): string[] {
  const trimmedParts = [...parts];
  while (
    trimmedParts.length > 0 &&
    countryTokens.has(normalizeCountryMatchToken(trimmedParts.at(-1) ?? ''))
  ) {
    trimmedParts.pop();
  }

  return trimmedParts;
}

/**
 * Best-effort manual parser for checkout address input when Places autocomplete
 * does not emit an onSelect payload. Supports common formats like:
 * - "Street, City, State"
 * - "Area, State"
 */
export function inferAddressLocationFromInput(
  address: string,
  shippingStates: string[],
  merchantCountry?: string,
): InferredAddressLocation | null {
  const parts = address
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  const locationParts = stripTrailingCountryTokens(
    parts,
    buildCountryLocationTokens(merchantCountry),
  );

  if (locationParts.length < 2) return null;

  const rawState = locationParts[locationParts.length - 1];
  const rawCity =
    locationParts.length >= 3
      ? locationParts[locationParts.length - 2]
      : locationParts[0];
  if (!rawState || !rawCity) return null;

  // Country-level / rest-of-world markets have no subdivision vocabulary for
  // the merchant's country, so `shippingStates` is empty and there is nothing
  // to match against. Accept the raw parsed city/state so the quote gate can
  // fire and merchant-configured rates stay reachable. Markets WITH a known
  // subdivision list (NG, IN, AE) still require a real match below.
  if (shippingStates.length === 0) {
    return { city: rawCity, state: rawState };
  }

  const matchedState = shippingStates.find((candidate) =>
    statesMatch(candidate, rawState),
  );
  if (!matchedState) return null;

  return {
    city: rawCity,
    state: matchedState,
  };
}

export function getDoorDeliveryQuotes(
  quotes: ShippingQuote[],
): ShippingQuote[] {
  return quotes.filter(
    (quote) =>
      !isStationPickupQuote(quote) && !isGiglGoFasterQuote(quote),
  );
}

export function getAirDeliveryQuotes(
  quotes: ShippingQuote[],
): ShippingQuote[] {
  return quotes.filter(isGiglGoFasterQuote);
}

export function getStationPickupQuote(
  quotes: ShippingQuote[],
): ShippingQuote | undefined {
  return quotes.find(isStationPickupQuote);
}

/**
 * All station-pickup quotes (carrier stations AND merchant pickup rates), in
 * quote order. A merchant can configure several pickup locations in one zone;
 * each surfaces as its own station-pickup quote with a distinct `mrate_<uuid>`
 * id, so the checkout must be able to list and select every one of them rather
 * than collapsing to the first via `getStationPickupQuote`.
 */
export function getStationPickupQuotes(
  quotes: ShippingQuote[],
): ShippingQuote[] {
  return quotes.filter(isStationPickupQuote);
}

export function getPreferredDoorQuoteId(quotes: ShippingQuote[]): string {
  return getDoorDeliveryQuotes(quotes)[0]?.id ?? '';
}

export function getSelectedQuoteIdForDeliveryMethod(
  deliveryMethod: DeliveryMethod,
  selectedQuoteId: string,
  shippingQuotes: ShippingQuote[],
): string {
  if (deliveryMethod === 'pickup_station') {
    // Preserve an already-selected pickup quote so a shopper who picks the
    // second of several merchant pickup locations, leaves the tab, and returns
    // isn't silently reset to the first one.
    const selectedQuote = shippingQuotes.find(
      (quote) => String(quote.id) === String(selectedQuoteId),
    );
    return selectedQuote && isStationPickupQuote(selectedQuote)
      ? selectedQuoteId
      : (getStationPickupQuote(shippingQuotes)?.id ?? selectedQuoteId);
  }

  if (deliveryMethod === 'door') {
    const selectedQuote = shippingQuotes.find(
      (quote) => String(quote.id) === String(selectedQuoteId),
    );
    return selectedQuote &&
      !isStationPickupQuote(selectedQuote) &&
      !isGiglGoFasterQuote(selectedQuote)
      ? selectedQuoteId
      : getPreferredDoorQuoteId(shippingQuotes);
  }

  if (deliveryMethod === 'airport') {
    const selectedQuote = shippingQuotes.find(
      (quote) => String(quote.id) === String(selectedQuoteId),
    );
    return isGiglGoFasterQuote(selectedQuote) ? selectedQuoteId : '';
  }

  return selectedQuoteId;
}

export function createSelectDeliveryMethod({
  selectedQuoteId,
  setDeliveryMethod,
  setSelectedQuoteId,
  shippingQuotes,
}: {
  selectedQuoteId: string;
  setDeliveryMethod: (method: DeliveryMethod) => void;
  setSelectedQuoteId: (quoteId: string) => void;
  shippingQuotes: ShippingQuote[];
}) {
  return (method: DeliveryMethod) => {
    setSelectedQuoteId(
      getSelectedQuoteIdForDeliveryMethod(
        method,
        selectedQuoteId,
        shippingQuotes,
      ),
    );
    setDeliveryMethod(method);
  };
}

export function resetDeliveryQuotesForAddressChange({
  setDeliveryMethod,
  setSelectedQuoteId,
  setShippingQuotes,
  clearDeliveryCoordinates,
}: {
  setDeliveryMethod: (method: DeliveryMethod) => void;
  setSelectedQuoteId: (quoteId: string) => void;
  setShippingQuotes: (quotes: ShippingQuote[]) => void;
  clearDeliveryCoordinates?: () => void;
}) {
  clearDeliveryCoordinates?.();
  setShippingQuotes([]);
  setSelectedQuoteId('');
  setDeliveryMethod('door');
}

export function getStationPickupAddressText(quote: ShippingQuote): string {
  return [quote.stationName, quote.stationAddress]
    .filter((line): line is string => Boolean(line))
    .join(', ');
}

/**
 * Merchant-configured rate quotes surface with `provider === 'MERCHANT'` and a
 * `mrate_<uuid>` id. These helpers let the checkout UI treat them
 * provider-agnostically while the order POST recovers the bare rate id.
 */
export function isMerchantQuote(quote: ShippingQuote): boolean {
  return quote.provider === MERCHANT_PROVIDER_CODE;
}

/**
 * Extract the bare `merchant_shipping_rates.id` from a selected quote id, or
 * `null` when the selection is a carrier quote. The order POST sends this as
 * `shipping_rate_id` (and forces the null shipping_provider/selected_quote_id
 * path) so the server recomputes the fee from rate config.
 */
export function getMerchantRateId(quoteId: string): string | null {
  return quoteId.startsWith(MERCHANT_RATE_ID_PREFIX)
    ? quoteId.slice(MERCHANT_RATE_ID_PREFIX.length) || null
    : null;
}

/**
 * The quote id safe to forward to the order-create and order-reuse APIs as
 * `selected_quote_id`.
 *
 * Returns `undefined` (i.e. "send nothing") when:
 *   - the method has no third-party quote (pickup/airport), or
 *   - the selection is a merchant rate. Merchant rates carry a synthetic
 *     `mrate_<uuid>` id that is NOT a persisted quote row — the server
 *     recomputes their fee from `shipping_rate_id` instead. Both the reuse
 *     route (`z.uuid()` on `selected_quote_id`) and the order-create RPC reject
 *     the synthetic id, so it must never be forwarded. The reuse route reopens
 *     an already-fee-verified pending order and does not re-verify shipping, so
 *     omitting it is safe.
 */
export function getForwardableSelectedQuoteId(
  deliveryMethod: DeliveryMethod,
  selectedQuoteId: string,
): string | undefined {
  if (deliveryMethod !== 'door' && deliveryMethod !== 'pickup_station') {
    return undefined;
  }
  if (getMerchantRateId(selectedQuoteId)) {
    return undefined;
  }
  return selectedQuoteId || undefined;
}

/**
 * Delivery-estimate line for a quote, or `null` when it should be omitted.
 * Merchant rates without configured days carry `estimatedDays === 0` (an
 * "unknown estimate" sentinel) — callers must not render "0 days".
 */
export function getDeliveryEstimateLabel(quote: ShippingQuote): string | null {
  if (quote.deliveryRange) return quote.deliveryRange;
  if (quote.estimatedDays > 0) return `${quote.estimatedDays} days`;
  return null;
}

/** Provider-aware copy for the shared station-pickup surfaces. */
export interface PickupStationCopy {
  /** Delivery-method tab label. */
  methodLabel: string;
  /** Delivery-method tab subtitle. */
  methodSubtitle: string;
  /** Heading shown in the selected-pickup detail card. */
  detailHeading: string;
  /** Fallback body when the quote carries no address text. */
  detailFallback: string;
  /** Title on the door-unavailable pickup affordance. */
  doorUnavailableTitle: string;
  /** Body on the door-unavailable pickup affordance. */
  doorUnavailableBody: string;
  /** CTA on the door-unavailable pickup affordance. */
  chooseButtonLabel: string;
}

const GIGL_PICKUP_STATION_COPY: PickupStationCopy = {
  methodLabel: 'Pickup Stations (GIGL)',
  methodSubtitle: 'Collect at service centre',
  detailHeading: 'Pickup Stations (GIGL)',
  detailFallback: 'Collect from the selected GIGL service centre.',
  doorUnavailableTitle:
    "GIGL doesn't currently support door delivery to this location.",
  doorUnavailableBody:
    'Choose Pickup Stations (GIGL) to collect from a nearby service centre.',
  chooseButtonLabel: 'Choose Pickup Stations (GIGL)',
};

const MERCHANT_PICKUP_STATION_COPY: PickupStationCopy = {
  methodLabel: 'Store Pickup',
  methodSubtitle: 'Collect in person',
  detailHeading: 'Store Pickup',
  detailFallback: 'Collect your order from the store.',
  doorUnavailableTitle: 'Pick up your order in person.',
  doorUnavailableBody: 'Collect your order from the pickup location below.',
  chooseButtonLabel: 'Choose Store Pickup',
};

/**
 * Provider-aware copy for the station-pickup surfaces. Merchant `pickup` rates
 * reuse the existing station-pickup delivery path (they set
 * `isStationPickup: true`), so the only difference is neutral, non-GIGL wording.
 */
export function getPickupStationCopy(
  quote: ShippingQuote | undefined,
): PickupStationCopy {
  return quote && isMerchantQuote(quote)
    ? MERCHANT_PICKUP_STATION_COPY
    : GIGL_PICKUP_STATION_COPY;
}

export function isGatewayAmountDifferentFromOrderTotal(
  payableAmount: number,
  orderAmount: number,
): boolean {
  if (!Number.isFinite(payableAmount) || !Number.isFinite(orderAmount)) {
    return true;
  }

  return Math.abs(orderAmount - payableAmount) >= 0.01;
}

export const KLUMP_WALLET_CREDIT_UNAVAILABLE_TOAST = {
  title: 'Klump unavailable with wallet credit',
  description:
    'Klump requires the full order total. Remove wallet credit or choose another payment method.',
  variant: 'destructive' as const,
};

export function isKlumpUnavailableForGatewayAmount({
  paymentMethod,
  payableAmount,
  orderAmount,
}: {
  paymentMethod: string;
  payableAmount: number;
  orderAmount: number;
}): boolean {
  return (
    paymentMethod === 'klump' &&
    isGatewayAmountDifferentFromOrderTotal(payableAmount, orderAmount)
  );
}
