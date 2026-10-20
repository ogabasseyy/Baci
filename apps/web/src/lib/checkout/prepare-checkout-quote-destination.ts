import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import { toInternationalQuoteValidationItemsFromOrder } from '@/lib/shipping/international-shipment-items';
import {
  enrichShippingAddressWithQuoteDestination,
  OrderQuoteDestinationMismatchError,
} from '@/lib/shipping/order-quote-destination';
import type { OrderCreateInput } from '@/schemas/orders';
import {
  CanonicalOrderSubtotalLoadError,
  isCanonicalOrderSubtotalUuidError,
} from './canonical-order-subtotal';
import { hasExistingKeyedOrder } from './has-existing-keyed-order';

type OrderQuoteValidationPayloadItem = {
  price?: number | string | null;
  product_id?: string | null;
  offer_id?: string | null;
  quantity: number;
};
type OrderQuoteValidationProductRow = {
  commodity_code?: string | null;
  dimensions?: unknown;
  id: string;
  name: string | null;
  weight_unit?: string | null;
  weight_value?: number | string | null;
};
async function buildOrderQuoteValidationItems({
  items,
  merchantId,
  offerPrices,
  supabase,
}: {
  items: OrderQuoteValidationPayloadItem[];
  merchantId: string;
  offerPrices: Map<string, number>;
  supabase: SupabaseClient;
}) {
  const productIds = Array.from(
    new Set(
      items
        .map((item) => item.product_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
    )
  );

  if (productIds.length === 0) {
    return items.map((item) => ({ name: null, quantity: item.quantity }));
  }

  const { data: products, error } = await supabase
    .from('products')
    .select('id, name, weight_value, weight_unit, dimensions, commodity_code')
    .eq('merchant_id', merchantId)
    .in('id', productIds)
    .returns<OrderQuoteValidationProductRow[]>();

  if (error || !products) {
    throw new CanonicalOrderSubtotalLoadError(
      'Unable to load products for international quote validation',
      { cause: error ?? undefined },
      (error as { code?: string } | null | undefined)?.code
    );
  }

  const productMap = new Map(products.map((product) => [product.id, product]));
  return toInternationalQuoteValidationItemsFromOrder(
    items.map((item) => {
      const product = item.product_id
        ? (productMap.get(item.product_id) ?? null)
        : null;
      // Exact offer lines bill the live offer price (the RPC persists
      // it), not the submitted price the shopper quoted days ago.
      // Validating against the stale value accepts checkout while the
      // booking guard later rejects fulfillment as a quote mismatch.
      const liveOfferPrice =
        item.offer_id && item.product_id
          ? offerPrices.get(`${item.product_id}::${item.offer_id}`)
          : undefined;
      return {
        name: product?.name ?? null,
        price: liveOfferPrice ?? item.price ?? null,
        quantity: item.quantity,
        product,
      };
    }),
    { includeValue: true }
  );
}

type PrepareCheckoutQuoteDestinationInput = {
  isIdempotentLocalAirportReplay: boolean;
  isIdempotentOrderReplay: boolean;
  items: OrderQuoteValidationPayloadItem[];
  merchantId: string;
  offerPrices?: Map<string, number>;
  requestIdempotencyKey?: string | null;
  selectedQuoteId: string | null;
  shippingAddress: OrderCreateInput['shipping_address'];
  shippingFee: number;
  shippingProvider: string | null;
  supabase: SupabaseClient;
};
type QuotePreparationResult =
  | {
      ok: true;
      shippingAddress: OrderCreateInput['shipping_address'];
      validatedQuoteProvider: string | null;
    }
  | {
      ok: false;
      status: number;
      body: { error: string; code?: string; details?: string };
    };

/** Reproduce checkout quote shape for new orders and confirmed keyed retries. */
export async function prepareCheckoutQuoteDestination({
  isIdempotentLocalAirportReplay,
  isIdempotentOrderReplay,
  items,
  merchantId,
  offerPrices,
  requestIdempotencyKey,
  selectedQuoteId,
  shippingAddress,
  shippingFee,
  shippingProvider,
  supabase,
}: PrepareCheckoutQuoteDestinationInput): Promise<QuotePreparationResult> {
  let quoteValidationItems:
    | Awaited<ReturnType<typeof buildOrderQuoteValidationItems>>
    | undefined;
  if (selectedQuoteId) {
    try {
      quoteValidationItems = await buildOrderQuoteValidationItems({
        items,
        merchantId,
        offerPrices: offerPrices ?? new Map<string, number>(),
        supabase,
      });
    } catch (error) {
      if (isCanonicalOrderSubtotalUuidError(error)) {
        logger.warn({
          error,
          merchantId,
          message:
            'Storefront order received malformed identifier during quote validation',
        });
        return {
          ok: false,
          status: 400,
          body: { error: 'Failed to create order', details: 'invalid_items' },
        };
      }
      logger.error({
        error,
        merchantId,
        message: 'Storefront order quote validation item lookup failed',
      });
      return {
        ok: false,
        status: 500,
        body: {
          code: 'QUOTE_VALIDATION_FAILED',
          error: 'Unable to validate quote',
        },
      };
    }
  }
  // Confirmed same-key retries skip expiry and catalog-derived item matching;
  // the RPC's stored hash enforces the caller's product, quantity and price.
  // Destination/pin, provider, merchant and fee checks remain authoritative.
  // A confirmed airport replay is already DB-confirmed by
  // validateLocalAirportDeliveryFee, so it is a quote replay too: reuse
  // that signal instead of probing again, or enrich would re-apply the
  // expiry check and reject the retry before the order RPC can replay it.
  const isConfirmedQuoteReplay =
    Boolean(selectedQuoteId && requestIdempotencyKey) &&
    (isIdempotentLocalAirportReplay ||
      (await hasExistingKeyedOrder({
        merchantId,
        requestIdempotencyKey,
        supabase,
      })));
  const bypassCheckoutContext =
    (isIdempotentLocalAirportReplay || isIdempotentOrderReplay) &&
    !isConfirmedQuoteReplay;
  let validatedQuoteProvider: string | null = null;
  try {
    const enrichedAddress = await enrichShippingAddressWithQuoteDestination(
      supabase,
      selectedQuoteId,
      shippingAddress,
      {
        isConfirmedReplay: isConfirmedQuoteReplay,
        isNewOrder: !isIdempotentOrderReplay || isConfirmedQuoteReplay,
        items: quoteValidationItems,
        merchantId,
        onValidatedQuoteProvider: (provider) => {
          validatedQuoteProvider = provider;
        },
        shippingFee: bypassCheckoutContext ? undefined : shippingFee,
        shippingProvider: bypassCheckoutContext ? null : shippingProvider,
      },
      {
        // Main #3704 contract: only new-order creation attaches the
        // quote's attested coordinates; replays never repair pins here.
        persistAttestedCoordinates:
          !isIdempotentLocalAirportReplay && !isIdempotentOrderReplay,
      }
    );
    return {
      ok: true,
      shippingAddress: enrichedAddress,
      validatedQuoteProvider,
    };
  } catch (error) {
    if (error instanceof OrderQuoteDestinationMismatchError) {
      return {
        ok: false,
        status: error.status,
        body: { error: error.message, code: error.code },
      };
    }
    throw error;
  }
}
