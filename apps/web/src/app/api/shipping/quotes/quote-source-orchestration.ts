import { resolveMerchantCurrencyConfig } from '@/lib/resolve-merchant-currency';
import { rankQuotes, selectFeaturedQuotes } from '@/lib/shipping/aggregator';
import type {
  QuoteRequest,
  QuoteResponse,
  ShippingProviderCode,
  ShippingQuote,
} from '@/lib/shipping/types';
import type { MerchantRateQuoteResult } from './merchant-rate-quotes';

const NON_NIGERIAN_MERCHANT_WARNING =
  'Shipping rates are unavailable: carrier rates currently cover Nigerian merchants only, and this merchant has not configured its own shipping rates yet.';

/**
 * Build the merchant-rate-only response shared by non-NG and fail-closed paths.
 */
export function buildMerchantOnlyQuoteResponse(
  merchantQuotes: ShippingQuote[],
  sessionId: string | undefined
): QuoteResponse {
  return {
    quotes: {
      featured: selectFeaturedQuotes(merchantQuotes),
      all: merchantQuotes,
    },
    sessionId: sessionId || crypto.randomUUID(),
    expiresAt:
      merchantQuotes[0]?.expiresAt.toISOString() ??
      new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    ...(merchantQuotes.length === 0
      ? { warnings: [NON_NIGERIAN_MERCHANT_WARNING] }
      : {}),
  } satisfies QuoteResponse;
}

export interface QuoteSourceOrchestrationInput {
  quoteRequest: QuoteRequest;
  merchantRateResult: MerchantRateQuoteResult;
  merchantCurrency: string;
  merchantCountry?: string;
  hasTrustedMerchantCurrencyContext: boolean;
  includeMerchantRateQuotes: boolean;
  sessionId?: string;
  getCarrierQuotes: (
    request: QuoteRequest,
    allowedProviderCodes?: readonly ShippingProviderCode[]
  ) => Promise<QuoteResponse>;
}

/**
 * Resolve merchant and carrier quote sources, applying currency/country and
 * provider-allowlist guards before carrier aggregation. A load failure in the
 * merchant-rate RPC is fail-closed: body-only callers return merchant-only,
 * while trusted callers pass an explicit empty provider list to the aggregator.
 */
export async function orchestrateQuoteSources({
  quoteRequest,
  merchantRateResult,
  merchantCurrency,
  merchantCountry,
  hasTrustedMerchantCurrencyContext,
  includeMerchantRateQuotes,
  sessionId,
  getCarrierQuotes,
}: QuoteSourceOrchestrationInput): Promise<QuoteResponse> {
  const {
    quotes: merchantQuotes,
    resolvedCurrency,
    resolvedCountry,
    loadFailed,
    enabledProviderCodes,
  } = merchantRateResult;

  const exposedMerchantQuotes = includeMerchantRateQuotes ? merchantQuotes : [];
  const merchantOnly = () =>
    buildMerchantOnlyQuoteResponse(exposedMerchantQuotes, sessionId);

  if (loadFailed && !hasTrustedMerchantCurrencyContext) {
    return merchantOnly();
  }

  const routeCurrency = resolveMerchantCurrencyConfig({
    country: merchantCountry,
    payout_currency: merchantCurrency,
  }).code;
  if (
    (resolvedCurrency && resolvedCurrency !== 'NGN') ||
    (resolvedCountry && resolvedCountry !== 'NG') ||
    routeCurrency !== 'NGN' ||
    (merchantCountry && merchantCountry !== 'NG')
  ) {
    return merchantOnly();
  }

  // A missing allowlist for a merchant-scoped request must never silently
  // widen to every carrier. Merchantless public/default requests keep the
  // canonical GIGL+Topship carriers. An explicit [] stays fail-closed.
  const allowedProviderCodes =
    enabledProviderCodes ??
    (quoteRequest.merchantId ? [] : (['GIGL', 'TOPSHIP'] as const));
  const carrierResponse = await getCarrierQuotes(
    quoteRequest,
    allowedProviderCodes
  );

  if (exposedMerchantQuotes.length === 0) {
    return carrierResponse;
  }

  const mergedQuotes = [
    ...carrierResponse.quotes.all,
    ...exposedMerchantQuotes,
  ];
  return {
    ...carrierResponse,
    quotes: {
      featured: selectFeaturedQuotes(mergedQuotes),
      all: rankQuotes(mergedQuotes),
    },
  };
}
