import { type NextRequest, NextResponse } from 'next/server';
import { resolveMerchantCurrencyConfig } from '@/lib/resolve-merchant-currency';
import { shippingService } from '@/lib/shipping';
import { normalizeNigerianQuoteReceiver } from '@/lib/shipping/normalize-nigerian-quote-receiver';
import {
  MERCHANT_PROVIDER_CODE,
  type QuoteRequest,
} from '@/lib/shipping/types';
import { createAdminClient } from '@/lib/supabase/admin';
import { QuoteRequestSchema } from '@/schemas/shipping';
import { postAdminOrderGiglQuote } from './admin-order-gigl-quote';
import {
  getMerchantRateQuotes,
  type MerchantRateQuoteResult,
} from './merchant-rate-quotes';
import { toPublicQuoteResponse } from './public-quote-response';
import { resolveQuoteMerchantContext } from './quote-merchant-context';
import {
  buildMerchantOnlyQuoteResponse,
  orchestrateQuoteSources,
} from './quote-source-orchestration';
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

    const supabase = createAdminClient();

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
    const merchantQuotesPromise = merchantContext.merchantId
      ? getMerchantRateQuotes(supabase, {
          merchantId: merchantContext.merchantId,
          receiverCountryCode: data.receiver.countryCode,
          receiverState: data.receiver.state,
          merchantCurrency,
          cartSubtotal: data.cart_subtotal,
        })
      : Promise.resolve<MerchantRateQuoteResult>({ quotes: [] });

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
      sessionId: data.sessionId || crypto.randomUUID(),
      shipmentType: data.shipmentType,
      deliveryPreference: data.deliveryPreference,
    };

    const merchantRateResult = await merchantQuotesPromise;
    const response = await orchestrateQuoteSources({
      quoteRequest,
      merchantRateResult,
      merchantCurrency,
      merchantCountry,
      hasTrustedMerchantCurrencyContext,
      includeMerchantRateQuotes,
      sessionId: data.sessionId,
      getCarrierQuotes: (request, allowedProviderCodes) =>
        shippingService.getQuotes(request, allowedProviderCodes),
    });

    const persistenceResults = await Promise.all(
      response.quotes.all
        .filter((quote) => quote.provider !== MERCHANT_PROVIDER_CODE)
        .map((quote) =>
          supabase.from('shipping_quotes').upsert(
            toShippingQuoteUpsert(quote, {
              merchantId: quoteRequest.merchantId,
              sessionId: response.sessionId,
              quoteRequest,
            }),
            { onConflict: 'id' }
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

    return NextResponse.json(toPublicQuoteResponse(response));
  } catch (error) {
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
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get('sessionId');

    if (!sessionId) {
      return NextResponse.json(
        { error: 'Session ID required' },
        { status: 400 }
      );
    }

    const supabase = createAdminClient();

    const { data: quotes, error } = await supabase
      .from('shipping_quotes')
      .select(
        'id, session_id, provider, service_tier, carrier_name, estimated_days, min_days, max_days, price, currency, pickup_included, insurance_included, is_station_pickup, station_name, station_address, provider_rate_id, expires_at'
      )
      .eq('session_id', sessionId)
      .gt('expires_at', new Date().toISOString())
      .order('price', { ascending: true });

    if (error) {
      console.error('Error fetching quotes:', error);
      return NextResponse.json(
        { error: 'Failed to fetch quotes' },
        { status: 500 }
      );
    }

    if (!quotes || quotes.length === 0) {
      return NextResponse.json(
        { error: 'Quotes expired or not found' },
        { status: 404 }
      );
    }

    const transformedQuotes = quotes.map((q) => ({
      id: q.id,
      provider: q.provider,
      serviceTier: q.service_tier,
      carrierName: q.carrier_name,
      displayName: q.carrier_name,
      estimatedDays: q.estimated_days,
      minDays: q.min_days,
      maxDays: q.max_days,
      price: q.price,
      currency: q.currency,
      pickupIncluded: q.pickup_included,
      insuranceIncluded: q.insurance_included,
      isStationPickup: q.is_station_pickup,
      stationName: q.station_name,
      stationAddress: q.station_address,
      providerRateId: q.provider_rate_id,
      expiresAt: new Date(q.expires_at),
    }));

    return NextResponse.json({
      quotes: {
        featured: transformedQuotes.slice(0, 3),
        all: transformedQuotes,
      },
      sessionId,
      expiresAt: quotes[0]?.expires_at,
    });
  } catch (error) {
    console.error('Error fetching cached quotes:', error);
    return NextResponse.json(
      { error: 'Failed to fetch quotes' },
      { status: 500 }
    );
  }
}
