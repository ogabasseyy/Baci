import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { resolvePublicMerchantSender } from '@/app/api/shipping/quotes/resolve-public-merchant-sender';
import { toShippingQuoteUpsert } from '@/app/api/shipping/quotes/shipping-quote-persistence';
import { logger } from '@/lib/logger';
import { shippingService } from '@/lib/shipping';
import { normalizeNigerianQuoteReceiver } from '@/lib/shipping/normalize-nigerian-quote-receiver';
import { readPackageDimensionsCm } from '@/lib/shipping/package-dimensions';
import { productWeightToKg } from '@/lib/shipping/product-weight-to-kg';
import { quoteProviderFailure } from '@/lib/shipping/quote-provider-failure';
import { createShippingQuoteRouteProof } from '@/lib/shipping/shipping-quote-route-proof';
import type { QuoteRequest } from '@/lib/shipping/types';
import { createAnonClient } from '@/lib/supabase/anon';
import { checkTenantRateLimitDetailed } from '@/lib/tenant-rate-limit';
import {
  crossRemDeliveryConfiguration,
  getCrossRemConnections,
} from '../catalog/catalog-bindings';
import { loadCrossRemCatalog } from '../catalog/catalog-service';
import { authorizePartner } from '../partner-connection';

export const maxDuration = 60;

const requestSchema = z.strictObject({
  items: z
    .array(
      z.strictObject({
        listing_id: z.string().trim().min(1).max(128),
        quantity: z.number().int().min(1).max(20),
      })
    )
    .min(1)
    .max(20)
    .refine(
      (items) =>
        new Set(items.map((item) => item.listing_id)).size === items.length,
      'Duplicate listing ID'
    ),
  destination: z.strictObject({
    address_line1: z.string().trim().min(1).max(256),
    address_line2: z.string().trim().min(1).max(256).optional(),
    city: z.string().trim().min(1).max(100),
    state: z.string().trim().min(1).max(100),
    country_code: z.literal('NG'),
    postal_code: z.string().trim().min(1).max(16).optional(),
    coordinates: z
      .strictObject({
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
      })
      .optional(),
  }),
});

const quoteColumns = 'id, weight_value, weight_unit, dimensions';
const defaultWeightKg = 1;

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
  const access = authorizePartner(
    request.headers.get('authorization'),
    getCrossRemConnections(),
    'quotes:write'
  );
  if (!access.ok) {
    return access.reason === 'scope_required'
      ? errorResponse(403, 'SCOPE_REQUIRED', requestId)
      : errorResponse(401, 'UNAUTHORIZED', requestId, {
          'WWW-Authenticate': 'Bearer',
        });
  }

  const parsed = requestSchema.safeParse(
    await request.json().catch(() => null)
  );
  if (!parsed.success) return errorResponse(400, 'INVALID_REQUEST', requestId);

  const { connectionId, merchantId } = access;
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

    const catalog = await loadCrossRemCatalog();
    const byId = new Map(
      catalog.listings.map((listing) => [listing.listing_id, listing])
    );
    const items = [];
    for (const item of parsed.data.items) {
      const listing = byId.get(item.listing_id);
      if (listing?.availability !== 'in_stock') {
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
    const [metadata, origin] = await Promise.all([
      db
        .from('products')
        .select(quoteColumns)
        .eq('merchant_id', merchantId)
        .in('id', [...new Set(items.map((item) => item.product_id))]),
      resolvePublicMerchantSender(db, merchantId),
    ]);
    if (
      metadata.error ||
      !origin.ok ||
      !origin.sender ||
      origin.sender.countryCode !== 'NG'
    ) {
      return errorResponse(503, 'QUOTE_UNAVAILABLE', requestId);
    }

    const products = new Map(metadata.data.map((row) => [row.id, row]));
    const parcel = [];
    for (const item of items) {
      const product = products.get(item.product_id);
      if (!product) return errorResponse(409, 'LISTING_UNAVAILABLE', requestId);
      parcel.push({
        name: item.title,
        quantity: item.quantity,
        value: item.base_unit_price_minor / 100,
        weight:
          productWeightToKg(product.weight_value, product.weight_unit) ??
          defaultWeightKg,
        ...readPackageDimensionsCm(product.dimensions),
      });
    }
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
      items: parcel,
      shipmentType: 'domestic',
      deliveryPreference: 'door',
    };

    const { carrier, validityMs, settlementBasis } =
      crossRemDeliveryConfiguration;
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
          Number.isFinite(rate.price) &&
          rate.price >= 0 &&
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
    const delivery = Math.round(selectedRate.price * 100);
    const subtotal = items.reduce(
      (sum, item) => sum + item.unit_price_minor * item.quantity,
      0
    );
    const merchantPayable = settlementBasis
      ? items.reduce(
          (sum, item) => sum + item.base_unit_price_minor * item.quantity,
          delivery
        )
      : null;
    if (
      !Number.isSafeInteger(subtotal + delivery) ||
      (merchantPayable !== null && !Number.isSafeInteger(merchantPayable))
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
      total_minor: subtotal + delivery,
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
