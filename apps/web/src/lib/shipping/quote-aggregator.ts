/**
 * Quote Aggregator
 * Fetches quotes from all enabled providers and ranks them for display
 */

import { rankQuotes, selectFeaturedQuotes } from './aggregator';
import {
  getNoProviderWarning,
  selectQuoteProviders,
} from './provider-allowlist';
import type { ShippingProviderRegistry } from './providers/base';
import type {
  QuoteRequest,
  QuoteResponse,
  ShippingProviderCode,
  ShippingQuote,
} from './types';

const QUOTE_TTL_SECONDS =
  Number(process.env.SHIPPING_QUOTE_TTL_SECONDS) || 3600;

export class QuoteAggregator {
  constructor(private registry: ShippingProviderRegistry) {}

  /**
   * Get aggregated quotes from all enabled providers
   */
  async getQuotes(
    request: QuoteRequest,
    allowedProviderCodes?: readonly ShippingProviderCode[]
  ): Promise<QuoteResponse> {
    const availableProviders =
      request.shipmentType === 'international'
        ? this.registry.getInternational()
        : this.registry.getDomestic();
    const { providers, isRestricted } = selectQuoteProviders(
      availableProviders,
      allowedProviderCodes
    );

    if (providers.length === 0) {
      // Surface the empty registry instead of serving a silent empty list —
      // indistinguishable from "no coverage" at the API boundary otherwise.
      console.warn('[QuoteAggregator] No providers registered for quotes', {
        shipmentType: request.shipmentType ?? 'domestic',
      });
      return createFallbackQuoteResponse(request.sessionId, [
        getNoProviderWarning(isRestricted),
      ]);
    }

    // Fetch from all providers in parallel
    const results = await Promise.allSettled(
      providers.map((provider) => provider.getQuotes(request))
    );

    const allQuotes: ShippingQuote[] = [];
    const warnings: string[] = [];

    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        allQuotes.push(...result.value);
      } else {
        warnings.push(
          `${providers[index].name}: ${result.reason?.message || 'Unknown error'}`
        );
        console.error('[QuoteAggregator] Provider failed', {
          provider: providers[index].name,
          reason: result.reason,
        });
      }
    });

    // If all providers failed, return fallback
    if (allQuotes.length === 0) {
      console.warn(
        '[QuoteAggregator] All providers failed, using fallback quote'
      );
      return createFallbackQuoteResponse(request.sessionId, warnings);
    }

    // Rank and categorize quotes
    const rankedQuotes = rankQuotes(allQuotes);
    const featuredQuotes = selectFeaturedQuotes(rankedQuotes);

    // Calculate expiry (use the earliest expiry from all quotes)
    const earliestExpiry = allQuotes.reduce(
      (min, q) => (q.expiresAt < min ? q.expiresAt : min),
      allQuotes[0].expiresAt
    );

    return {
      quotes: {
        featured: featuredQuotes,
        all: rankedQuotes,
      },
      sessionId: request.sessionId,
      expiresAt: earliestExpiry.toISOString(),
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }
}

/**
 * Create a fallback response when no providers are available
 * Returns EMPTY quotes to trigger the "Refresh Rates" UI in checkout
 */
function createFallbackQuoteResponse(
  sessionId: string,
  warnings?: string[]
): QuoteResponse {
  return {
    quotes: {
      featured: [],
      all: [],
    },
    sessionId,
    expiresAt: new Date(Date.now() + QUOTE_TTL_SECONDS * 1000).toISOString(),
    warnings,
  };
}
