import { randomUUID } from 'node:crypto';
import { resolvePublicMerchantSender } from '@/app/api/shipping/quotes/resolve-public-merchant-sender';
import { toShippingQuoteUpsert } from '@/app/api/shipping/quotes/shipping-quote-persistence';
import { readBoundedJsonBody } from '@/lib/events/read-bounded-json-body';
import { logger } from '@/lib/logger';
import { shippingService } from '@/lib/shipping';
import { normalizeNigerianQuoteReceiver } from '@/lib/shipping/normalize-nigerian-quote-receiver';
import { quoteProviderFailure } from '@/lib/shipping/quote-provider-failure';
import { createShippingQuoteRouteProof } from '@/lib/shipping/shipping-quote-route-proof';
import { toKobo } from '@/lib/shipping/to-kobo';
import type { QuoteRequest } from '@/lib/shipping/types';
import { createAnonClient } from '@/lib/supabase/anon';
import { checkTenantRateLimitDetailed } from '@/lib/tenant-rate-limit';
import { partnerQuoteRequestSchema } from '@/schemas/partner-quote-request';
import { authorizePartnerProfile } from '../partner-profile';
import { getPartnerProfiles } from '../partner-profiles';
import { buildPartnerQuoteParcel } from './quote-parcel';

export const maxDuration = 60;

const quoteColumns =
  'id, name, weight_value, weight_unit, dimensions, vat_category_code, vat_rate';

function errorResponse(
  status: number,
  code: string,
  requestId: string,
  headers?: HeadersInit
) {
  return Response.json(
    { error: { code }, request_id: requestId },
    {
      status,
      headers: { 'Cache-Control': 'private, no-store', ...headers },
    }
  );
}

export async function POST(request: Request) {
  const requestId = randomUUID();
  const access = authorizePartnerProfile(
    request.headers.get('authorization'),
    'quotes:write',
    getPartnerProfiles()
  );
  if (!access.ok) {
    return access.reason === 'scope_required'
      ? errorResponse(403, 'SCOPE_REQUIRED', requestId)
      : errorResponse(401, 'UNAUTHORIZED', requestId, {
          'WWW-Authenticate': 'Bearer',
        });
  }

  const body = await readBoundedJsonBody(request, 8192);
  if (!body.ok) {
    return body.reason === 'too_large'
      ? errorResponse(413, 'PAYLOAD_TOO_LARGE', requestId)
      : errorResponse(400, 'INVALID_REQUEST', requestId);
  }
  const parsed = partnerQuoteRequestSchema.safeParse(body.body);
  if (!parsed.success) return errorResponse(400, 'INVALID_REQUEST', requestId);

  const { connectionId, merchantId, profile } = access;
  const { carrier, validityMs, settlementBasis } = profile.delivery;
  try {
    const limit = await checkTenantRateLimitDetailed(
      'partner-delivery-quote',
      connectionId,
      {
        maxRequests: 30,
        windowMs: 60_000,
      }
    );
    if (limit.verdict === 'unavailable') {
      return errorResponse(503, 'QUOTE_UNAVAILABLE', requestId);
    }
    if (limit.verdict === 'denied') {
      const retryAfter = Math.max(
        1,
        Math.ceil(((limit.resetAt ?? Date.now() + 60_000) - Date.now()) / 1000)
      );
      return errorResponse(429, 'RATE_LIMITED', requestId, {
        'Retry-After': String(retryAfter),
      });
    }

    if (settlementBasis === null) {
      logger.warn({
        message: 'Partner quote settlement policy is unconfigured',
        connectionId,
        requestId,
      });
      return errorResponse(503, 'QUOTE_UNAVAILABLE', requestId);
    }
    const catalog = await profile.loadCatalog();
    const byId = new Map(
      catalog.listings.map((listing) => [listing.listing_id, listing])
    );
    const items = [];
    for (const item of parsed.data.items) {
      const listing = byId.get(item.listing_id);
      const available = catalog.stockByListing.get(item.listing_id);
      if (
        listing?.availability !== 'in_stock' ||
        !available ||
        item.quantity > available
      ) {
        return errorResponse(409, 'LISTING_UNAVAILABLE', requestId);
      }
      items.push({
        listing_id: item.listing_id,
        quantity: item.quantity,
        product_id: listing.product_id,
        variant_id: listing.variant_id,
        offer_id: listing.offer_id,
        title: listing.title,
        condition: listing.condition,
        unit_price_minor: listing.price_minor,
        base_unit_price_minor: listing.base_price_minor,
      });
    }
    const db = createAnonClient();
    const [metadata, origin, merchant] = await Promise.all([
      db
        .from('products')
        .select(quoteColumns)
        .eq('merchant_id', merchantId)
        .in('id', [...new Set(items.map((item) => item.product_id))]),
      resolvePublicMerchantSender(db, merchantId),
      db
        .from('merchants')
        .select('vat_registration_status')
        .eq('id', merchantId)
        .maybeSingle(),
    ]);
    if (metadata.error || merchant.error || !merchant.data || !origin.ok)
      return errorResponse(503, 'QUOTE_UNAVAILABLE', requestId);
    const country = origin.country?.trim().toUpperCase();
    if (origin.sender?.countryCode !== 'NG' || country !== 'NG') {
      logger.warn({
        message: 'Partner quote sender is missing or outside Nigeria',
        connectionId,
        requestId,
      });
      return errorResponse(503, 'QUOTE_UNAVAILABLE', requestId);
    }
    const parcel = buildPartnerQuoteParcel(
      items,
      metadata.data,
      merchant.data.vat_registration_status === 'registered'
    );
    if (!parcel) return errorResponse(409, 'LISTING_UNAVAILABLE', requestId);
    const { taxMinor } = parcel;
    const destination = parsed.data.destination;
    const quoteRequest: QuoteRequest = {
      sessionId: requestId,
      merchantId,
      sender: origin.sender,
      receiver: normalizeNigerianQuoteReceiver(
        {
          name: 'Recipient',
          phone: '',
          address: [destination.address_line1, destination.address_line2]
            .filter(Boolean)
            .join(', '),
          city: destination.city,
          state: destination.state,
          country: 'Nigeria',
          countryCode: destination.country_code,
          postalCode: destination.postal_code,
          ...destination.coordinates,
        },
        'domestic'
      ),
      items: parcel.items,
      shipmentType: 'domestic',
      deliveryPreference: 'door',
    };

    const rates = await shippingService.getProviderQuotes(
      carrier,
      quoteRequest
    );
    if (quoteProviderFailure.get(rates)) {
      return errorResponse(503, 'CARRIER_UNAVAILABLE', requestId);
    }
    const doorRates = rates.filter((rate) => !rate.isStationPickup);
    if (doorRates.length === 0) {
      return errorResponse(422, 'ADDRESS_UNSERVICEABLE', requestId);
    }
    const now = Date.now();
    const selectedRate = doorRates
      .filter(
        (rate) =>
          rate.provider === carrier &&
          rate.currency === 'NGN' &&
          rate.providerRateId &&
          (toKobo(rate.price) ?? 0) > 0 &&
          rate.expiresAt.getTime() > now
      )
      .sort(
        (a, b) =>
          a.price - b.price || a.serviceTier.localeCompare(b.serviceTier)
      )[0];
    if (!selectedRate)
      return errorResponse(503, 'CARRIER_UNAVAILABLE', requestId);

    const expiry = new Date(
      Math.min(now + validityMs, selectedRate.expiresAt.getTime())
    );
    const delivery = toKobo(selectedRate.price) ?? 0;
    const subtotal = items.reduce(
      (sum, item) => sum + item.unit_price_minor * item.quantity,
      0
    );
    const merchantPayable = items.reduce(
      (sum, item) => sum + item.base_unit_price_minor * item.quantity,
      delivery + taxMinor
    );
    const total = subtotal + delivery + taxMinor;
    if (
      !Number.isSafeInteger(total) ||
      !Number.isSafeInteger(merchantPayable)
    ) {
      return errorResponse(503, 'QUOTE_UNAVAILABLE', requestId);
    }
    const response = {
      quote_id: selectedRate.id,
      currency: 'NGN',
      items: items.map(
        ({ listing_id, quantity, condition, unit_price_minor }) => ({
          listing_id,
          quantity,
          condition,
          unit_price_minor,
        })
      ),
      subtotal_minor: subtotal,
      delivery_minor: delivery,
      tax_minor: taxMinor,
      total_minor: total,
      service: selectedRate.serviceTier,
      estimated_days: selectedRate.estimatedDays,
      expires_at: expiry.toISOString(),
      stock_reserved: false,
    };
    const snapshot = {
      ...response,
      items,
      settlement_basis: settlementBasis,
      merchant_payable_minor: merchantPayable,
      carrier_quote: toShippingQuoteUpsert(
        { ...selectedRate, expiresAt: expiry },
        {
          merchantId,
          sessionId: requestId,
          quoteRequest,
        }
      ),
    };
    const proof = createShippingQuoteRouteProof({
      action: 'persist_partner_delivery_quote',
      merchantId,
      subjectId: selectedRate.id,
      payload: {
        connection_id: connectionId,
        expires_at: response.expires_at,
        snapshot,
      },
    });
    const stored = await db.rpc('persist_partner_delivery_quote', {
      p_quote_id: selectedRate.id,
      p_merchant_id: merchantId,
      p_connection_id: connectionId,
      p_expires_at: response.expires_at,
      p_snapshot: snapshot,
      p_route_proof: proof,
    });
    if (stored.error || stored.data !== selectedRate.id) {
      return errorResponse(503, 'QUOTE_UNAVAILABLE', requestId);
    }
    return Response.json(
      { ...response, request_id: requestId },
      {
        status: 201,
        headers: { 'Cache-Control': 'private, no-store' },
      }
    );
  } catch {
    logger.warn({
      message: 'Partner delivery quote unavailable',
      connectionId,
      requestId,
    });
    return errorResponse(503, 'QUOTE_UNAVAILABLE', requestId);
  }
}
