import { type NextRequest, NextResponse } from 'next/server';
import { resolveMerchantCurrencyConfig } from '@/lib/resolve-merchant-currency';
import { shippingService } from '@/lib/shipping';
import { normalizeNigerianQuoteReceiver } from '@/lib/shipping/normalize-nigerian-quote-receiver';
import {
  createQuoteReadCapability,
  quoteReadCookieName,
  readQuoteRequestCapability,
} from '@/lib/shipping/quote-session-capability';
import {
  assertStorefrontQuoteStorage,
  persistStorefrontShippingQuote,
  QuoteStorageUnavailable,
  resolveStorefrontQuoteSession,
} from '@/lib/shipping/storefront-quote-attestation';
import {
  MERCHANT_PROVIDER_CODE,
  type QuoteRequest,
} from '@/lib/shipping/types';
import { createClient } from '@/lib/supabase/server';
import { QuoteRequestSchema } from '@/schemas/shipping';
import { postAdminOrderGiglQuote } from './admin-order-gigl-quote';
import { loadPublicMerchantRates } from './load-public-merchant-rates';
import { toPublicQuoteResponse } from './public-quote-response';
import { resolveQuoteMerchantContext } from './quote-merchant-context';
import {
  buildMerchantOnlyQuoteResponse,
  orchestrateQuoteSources,
} from './quote-source-orchestration';
import { readCachedShippingQuotes } from './read-cached-quotes';
import { resolveQuoteSender } from './resolve-quote-sender';
import { toShippingQuoteUpsert } from './shipping-quote-persistence';

// =============================================================================
// POST /api/shipping/quotes - Get shipping quotes
// =============================================================================

export async function POST(request: NextRequest) {
  try {
    // CSRF: handled by Origin-based middleware in proxy.ts (guest storefront route)
    if (request.headers.get('x-baci-admin-order-mode') === '1') {
      return await postAdminOrderGiglQuote(request);
    }
    const body = await request.json();

    if (
      body &&
      typeof body === 'object' &&
      typeof body.admin_order_id === 'string'
    ) {
      return NextResponse.json(
        { error: 'Admin order mode header required' },
        { status: 400 }
      );
    }

    // Validate request
    const parseResult = QuoteRequestSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        {
          error: 'Invalid request',
          details: parseResult.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    const data = {
      ...parseResult.data,
      receiver: normalizeNigerianQuoteReceiver(
        parseResult.data.receiver,
        parseResult.data.shipmentType
      ),
    };

    const supabase = await createClient();

    const merchantContext = await resolveQuoteMerchantContext({
      data,
      request,
      supabase,
    });
    if (!merchantContext.ok) {
      return NextResponse.json(
        { error: merchantContext.error },
        { status: merchantContext.status }
      );
    }
    const merchantCountry = merchantContext.merchantCountry
      ?.trim()
      .toUpperCase();
    const merchantCurrency = resolveMerchantCurrencyConfig({
      country: merchantCountry,
      payout_currency: merchantContext.merchantPayoutCurrency,
    }).code;

    const hasTrustedMerchantCurrencyContext =
      merchantContext.merchantCountry != null ||
      merchantContext.merchantPayoutCurrency != null;

    const includeMerchantRateQuotes = data.supports_merchant_rates === true;
    const merchantQuotesPromise = loadPublicMerchantRates(
      merchantContext.merchantId,
      {
        receiverCountryCode: data.receiver.countryCode,
        receiverState: data.receiver.state,
        merchantCurrency,
        cartSubtotal: data.cart_subtotal,
      }
    );

    if (data.merchant_rates_only) {
      const result = await merchantQuotesPromise;
      if (result.loadFailed) {
        return NextResponse.json(
          {
            error: 'Store delivery options could not be loaded. Please retry.',
          },
          { status: 503 }
        );
      }
      const response = buildMerchantOnlyQuoteResponse(
        includeMerchantRateQuotes ? result.quotes : [],
        data.sessionId
      );
      if (response.quotes.all.length === 0) {
        response.warnings = [
          'No store delivery or pickup rates match this address.',
        ];
      }
      return NextResponse.json(toPublicQuoteResponse(response));
    }

    // Every registered carrier (Topship/GIGL) is Nigerian and quotes are
    // NGN-denominated with a Nigeria origin. Both a merchant whose canonical
    // currency (payout_currency -> country -> NGN) is not NGN and a merchant
    // whose country is not Nigeria must not receive these quotes: the rates
    // would be wrong in origin and/or currency. Carriers are skipped for them
    // and merchant-configured rates become the only quote source.
    if (
      merchantCurrency !== 'NGN' ||
      (merchantCountry && merchantCountry !== 'NG')
    ) {
      const { quotes: merchantQuotes } = await merchantQuotesPromise;
      return NextResponse.json(
        buildMerchantOnlyQuoteResponse(
          includeMerchantRateQuotes ? merchantQuotes : [],
          data.sessionId
        )
      );
    }

    const senderResult = resolveQuoteSender({
      merchantId: merchantContext.merchantId,
      sender: merchantContext.senderInfo,
      shipmentType: data.shipmentType,
    });
    if (!senderResult.ok) {
      return NextResponse.json(
        { error: senderResult.error },
        { status: senderResult.status }
      );
    }

    const requestedCapability = readQuoteRequestCapability(
      request,
      merchantContext.merchantId
    );
    const quoteSession = await resolveStorefrontQuoteSession(
      supabase,
      merchantContext.merchantId,
      data.sessionId,
      requestedCapability
    );
    const quoteRequest: QuoteRequest = {
      merchantId: merchantContext.merchantId,
      sender: senderResult.sender,
      receiver: {
        ...data.receiver,
        phone: data.receiver.phone || '',
        country: data.receiver.country,
        countryCode: data.receiver.countryCode,
      },
      items: data.items,
      sessionId: quoteSession,
      shipmentType: data.shipmentType,
      deliveryPreference: data.deliveryPreference,
    };

    const merchantRateResult = await merchantQuotesPromise;
    const sourceResponse = await orchestrateQuoteSources({
      quoteRequest,
      merchantRateResult,
      merchantCurrency,
      merchantCountry,
      hasTrustedMerchantCurrencyContext,
      includeMerchantRateQuotes,
      sessionId: quoteSession,
      getCarrierQuotes: async (request, allowedProviderCodes) => {
        if (quoteRequest.merchantId && allowedProviderCodes?.length !== 0)
          await assertStorefrontQuoteStorage(supabase, quoteRequest.merchantId);
        return shippingService.getQuotes(request, allowedProviderCodes);
      },
    });

    const response = { ...sourceResponse, sessionId: quoteSession };

    const persistenceResults = await Promise.all(
      response.quotes.all
        .filter(
          (quote) =>
            !!quoteRequest.merchantId &&
            quote.provider !== MERCHANT_PROVIDER_CODE
        )
        .map((quote) =>
          persistStorefrontShippingQuote(
            supabase,
            toShippingQuoteUpsert(quote, {
              merchantId: quoteRequest.merchantId,
              sessionId: response.sessionId,
              quoteRequest,
            })
          )
        )
    );
    const persistenceFailure = persistenceResults.find(
      (result) => result.error
    );
    if (persistenceFailure?.error) {
      console.error('Error persisting shipping quote', {
        code: persistenceFailure.error.code,
        message: persistenceFailure.error.message,
      });
      return NextResponse.json(
        { error: 'Failed to get shipping quotes' },
        { status: 500 }
      );
    }

    const result = NextResponse.json(toPublicQuoteResponse(response));
    result.headers.set('Cache-Control', 'no-store');
    if (persistenceResults.length && quoteRequest.merchantId) {
      const capability = createQuoteReadCapability(
        quoteRequest.merchantId,
        response.sessionId
      );
      result.headers.set('X-Baci-Quote-Read-Token', capability);
      result.cookies.set(
        quoteReadCookieName(quoteRequest.merchantId),
        capability,
        {
          httpOnly: true,
          sameSite: 'lax',
          secure: request.nextUrl?.protocol === 'https:',
          path: '/api/shipping/quotes',
          maxAge: 300,
        }
      );
    }
    return result;
  } catch (error) {
    if (error instanceof QuoteStorageUnavailable)
      return NextResponse.json(
        {
          error: 'Carrier quotes temporarily unavailable',
          code: 'QUOTE_STORAGE_UNAVAILABLE',
        },
        { status: 503 }
      );
    console.error('Error getting shipping quotes:', error);
    return NextResponse.json(
      { error: 'Failed to get shipping quotes' },
      { status: 500 }
    );
  }
}

// =============================================================================
// GET /api/shipping/quotes?sessionId=xxx - Get cached quotes by session ID
// =============================================================================

export async function GET(request: NextRequest) {
  return await readCachedShippingQuotes(request);
}
