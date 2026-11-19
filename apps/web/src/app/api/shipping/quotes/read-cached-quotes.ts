import { type NextRequest, NextResponse } from 'next/server';
import { readQuoteRequestCapability } from '@/lib/shipping/quote-session-capability';
import { readStorefrontShippingQuotes } from '@/lib/shipping/storefront-quote-attestation';
import { createClient } from '@/lib/supabase/server';
import { storefrontShippingQuoteReadSchema } from '@/schemas/storefront-shipping-quote';
import { resolveQuoteMerchantContext } from './quote-merchant-context';
export async function readCachedShippingQuotes(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const input = storefrontShippingQuoteReadSchema.safeParse({
      sessionId: searchParams.get('sessionId'),
      ...(searchParams.get('merchantId')
        ? { merchantId: searchParams.get('merchantId') }
        : {}),
    });
    if (!input.success)
      return NextResponse.json(
        { error: 'Valid session ID required' },
        { status: 400 }
      );
    const { sessionId, merchantId } = input.data;
    const supabase = await createClient();
    const context = await resolveQuoteMerchantContext({
      data: { shipmentType: 'domestic', merchantId },
      request,
      supabase,
    });
    if (!context.ok || !context.merchantId)
      return NextResponse.json({ error: 'Store unavailable' }, { status: 403 });
    const token = readQuoteRequestCapability(request, context.merchantId);
    const { data: quotes, error } = await readStorefrontShippingQuotes(
      supabase,
      context.merchantId,
      sessionId,
      token
    );
    if (error && ['QUOTE_SESSION_REQUIRED', '42501'].includes(error.code ?? ''))
      return NextResponse.json(
        { error: 'Quote session required' },
        { status: 403 }
      );

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

    return NextResponse.json(
      {
        quotes: {
          featured: transformedQuotes.slice(0, 3),
          all: transformedQuotes,
        },
        sessionId,
        expiresAt: quotes[0]?.expires_at,
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    console.error('Error fetching cached quotes:', error);
    return NextResponse.json(
      { error: 'Failed to fetch quotes' },
      { status: 500 }
    );
  }
}
