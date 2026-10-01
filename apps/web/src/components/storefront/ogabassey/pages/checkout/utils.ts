import { getCountryByCode } from '@/lib/countries';
import type {
  CryptoChain,
  CryptoCurrency,
} from './types';

export {
  calculateDeliveryCost,
} from './calculate-delivery-cost';
export { isGiglGoFasterQuote } from './is-gigl-go-faster-quote';
export { isStationPickupQuote } from './is-station-pickup-quote';
export {
  createSelectDeliveryMethod,
  getAirDeliveryQuotes,
  getDoorDeliveryQuotes,
  getDeliveryEstimateLabel,
  getForwardableSelectedQuoteId,
  getMerchantRateId,
  getPickupStationCopy,
  getPreferredDoorQuoteId,
  getSelectedQuoteIdForDeliveryMethod,
  getStationPickupAddressText,
  getStationPickupQuote,
  getStationPickupQuotes,
  isMerchantQuote,
  resetDeliveryQuotesForAddressChange,
  type PickupStationCopy,
} from './delivery-quote-utils';

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
