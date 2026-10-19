import type { QuoteResponse, ShippingQuote } from '@/lib/shipping/types';

function redactQuote(quote: ShippingQuote): ShippingQuote {
  const {
    rawResponse: _rawResponse,
    providerCost: _providerCost,
    platformMargin: _platformMargin,
    marginBasisPoints: _marginBasisPoints,
    pricingVersion: _pricingVersion,
    ...publicQuote
  } = quote;
  return publicQuote;
}

export function toPublicQuoteResponse(response: QuoteResponse): QuoteResponse {
  return {
    ...response,
    quotes: {
      featured: response.quotes.featured.map(redactQuote),
      all: response.quotes.all.map(redactQuote),
    },
  };
}
