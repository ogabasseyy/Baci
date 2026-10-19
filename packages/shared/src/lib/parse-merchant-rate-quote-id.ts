const MERCHANT_RATE_QUOTE_ID_PREFIX = 'mrate_';
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Parses a synthetic merchant-rate quote id (`mrate_<uuid>`) into its bare
 * rate id. Returns undefined for anything else so web and mobile checkout
 * builders share one prefix/UUID contract.
 */
export function parseMerchantRateQuoteId(quoteId: unknown): string | undefined {
  if (typeof quoteId !== 'string') return undefined;
  if (!quoteId.startsWith(MERCHANT_RATE_QUOTE_ID_PREFIX)) return undefined;
  const rateId = quoteId.slice(MERCHANT_RATE_QUOTE_ID_PREFIX.length);
  return UUID_PATTERN.test(rateId) ? rateId : undefined;
}
