import type { SupabaseClient } from '@supabase/supabase-js';
import { shippingService } from '@/lib/shipping';
import { resolveAdminGiglBookingContext } from '@/lib/shipping/admin-gigl-booking-context';
import {
  assertGiglCustomerCheckoutPrepaid,
  isPayOnDeliveryPaymentMethod,
} from '@/lib/shipping/assert-gigl-customer-checkout-prepaid';
import { assertQuotePriceMatchesOrderFee } from '@/lib/shipping/assert-quote-price-matches-order-fee';
import { attachBookingQuoteMetadata } from '@/lib/shipping/attach-booking-quote-metadata';
import type { BookOrderRecord } from '@/lib/shipping/book-order-shipment-types';
import { buildOrderShipmentBookingRequest } from '@/lib/shipping/build-order-shipment-booking-request';
import {
  findReusableOrderShipment,
  type ReusableOrderShipmentResult,
} from '@/lib/shipping/find-reusable-order-shipment';
import { assertQuoteItemsMatchOrder } from '@/lib/shipping/international-quote-items-match';
import {
  assertInternationalQuoteMatchesOrder,
  assertQuoteReceiverMatchesOrder,
} from '@/lib/shipping/international-quote-order-guard';
import { toInternationalShipmentItemsFromOrder } from '@/lib/shipping/international-shipment-items';
import {
  isShippingProviderCode,
  OrderShipmentBookingError,
  parseStoredQuoteRequest,
  toDomesticBookingItems,
  toQuoteComparableOrderItems,
} from '@/lib/shipping/order-shipment-booking-utils';
import { persistBookedOrderShipment } from '@/lib/shipping/persist-booked-order-shipment';
import { isGiglInternationalProviderRate } from '@/lib/shipping/providers/gigl.international-payload';
import {
  type OrderShipmentQuoteRecord,
  refreshOrderShipmentQuote,
} from '@/lib/shipping/refresh-order-shipment-quote';
import { resolveBookingMerchantSender } from '@/lib/shipping/resolve-booking-merchant-sender';
import {
  applyShippingQuoteBookingEconomicsToOrder,
  applyShippingQuoteBookingEconomicsToQuote,
  getShippingQuoteBookingEconomics,
} from '@/lib/shipping/shipping-quote-booking-economics';
import type { ShippingAddress } from '@/lib/shipping/types';

export type BookOrderShipmentResult = ReusableOrderShipmentResult;

export async function bookOrderShipment(
  supabase: SupabaseClient,
  merchantId: string,
  orderId: string,
  quoteIdOverride?: string
): Promise<BookOrderShipmentResult> {
  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select(
      'id, customer_name, customer_email, customer_phone, shipping_fee, selected_quote_id, shipping_provider, shipping_funding_source, payment_method, payment_status, shipping_address, order_items(name, quantity, price, product_id, product:products!order_items_product_id_fkey(weight_value, weight_unit, dimensions, commodity_code))'
    )
    .eq('id', orderId)
    .eq('merchant_id', merchantId)
    .single();
  const typedOrder = order as BookOrderRecord | null;
  if (orderError || !typedOrder) {
    throw new OrderShipmentBookingError(
      'Order not found',
      404,
      'ORDER_NOT_FOUND'
    );
  }
  const existingShipment = await findReusableOrderShipment(
    supabase,
    merchantId,
    orderId
  );
  if (existingShipment) {
    return {
      ...existingShipment,
      quoteId: existingShipment.quoteId || typedOrder.selected_quote_id || '',
    };
  }
  const selectedQuoteId = quoteIdOverride ?? typedOrder.selected_quote_id;
  if (!selectedQuoteId) {
    throw new OrderShipmentBookingError(
      'This order does not have a saved shipping quote. Please get a new quote before shipping.',
      400,
      'MISSING_SHIPPING_QUOTE'
    );
  }
  const shippingProvider = typedOrder.shipping_provider;
  if (!isShippingProviderCode(shippingProvider)) {
    throw new OrderShipmentBookingError(
      'This order is not configured for provider-backed shipping.',
      400,
      'INVALID_SHIPPING_PROVIDER'
    );
  }
  // Fail closed on unpaid/POD before any quote lookup. Retention markers for
  // paid customer-checkout bookings are attached after the economics RPC.
  if (
    typedOrder.shipping_provider === 'GIGL' &&
    typedOrder.shipping_funding_source !== 'merchant_wallet' &&
    ((typedOrder.payment_status ?? '').trim().toLowerCase() !== 'paid' ||
      isPayOnDeliveryPaymentMethod(typedOrder.payment_method))
  ) {
    await assertGiglCustomerCheckoutPrepaid(typedOrder, {
      supabase,
      merchantId,
      orderId,
    });
  }
  const orderItems = typedOrder.order_items ?? [];
  if (orderItems.length === 0) {
    throw new OrderShipmentBookingError(
      'Cannot book a shipment for an order with no items.',
      400,
      'MISSING_ORDER_ITEMS'
    );
  }
  const { data: storedQuote, error: quoteError } = await supabase
    .from('shipping_quotes')
    .select(
      'id, merchant_id, provider, service_tier, carrier_name, price, currency, estimated_days, provider_rate_id, expires_at, quote_request'
    )
    .eq('id', selectedQuoteId)
    .eq('merchant_id', merchantId)
    .single();
  const typedStoredQuote = storedQuote as OrderShipmentQuoteRecord | null;
  if (quoteError || !typedStoredQuote) {
    throw new OrderShipmentBookingError(
      'The saved shipping quote could not be found.',
      404,
      'QUOTE_NOT_FOUND'
    );
  }

  const bookingEconomics = await getShippingQuoteBookingEconomics(
    supabase,
    merchantId,
    typedOrder.id,
    selectedQuoteId
  );
  const orderWithEconomics = applyShippingQuoteBookingEconomicsToOrder(
    typedOrder,
    bookingEconomics
  );
  await assertGiglCustomerCheckoutPrepaid(orderWithEconomics, {
    supabase,
    merchantId,
    orderId,
  });
  const bookingQuote = await attachBookingQuoteMetadata(
    supabase,
    merchantId,
    orderWithEconomics.id,
    applyShippingQuoteBookingEconomicsToQuote(
      typedStoredQuote,
      bookingEconomics
    )
  );

  const isGiglInternationalQuote = isGiglInternationalProviderRate(
    shippingProvider,
    typedStoredQuote.provider_rate_id
  );
  const storedQuoteRequest = parseStoredQuoteRequest(
    typedStoredQuote.quote_request
  );
  const isInternationalQuote =
    isGiglInternationalQuote ||
    storedQuoteRequest?.shipmentType === 'international';
  if (isGiglInternationalQuote && !storedQuoteRequest) {
    throw new OrderShipmentBookingError(
      'The saved international shipping quote is missing its original request. Please get a new quote before shipping.',
      400,
      'INTERNATIONAL_QUOTE_REQUEST_MISSING'
    );
  }
  let merchantSender: ShippingAddress | undefined;
  if (!isInternationalQuote) {
    const merchantSenderResult = await resolveBookingMerchantSender(
      supabase,
      merchantId
    );
    if (!merchantSenderResult.ok) {
      const isOriginMissing = merchantSenderResult.status === 400;
      const isMerchantMissing = merchantSenderResult.status === 404;
      throw new OrderShipmentBookingError(
        isOriginMissing
          ? 'Merchant shipping origin is not configured.'
          : isMerchantMissing
            ? 'Merchant details not found.'
            : 'Failed to resolve merchant shipping origin. Please try again.',
        merchantSenderResult.status,
        isOriginMissing
          ? 'MERCHANT_ORIGIN_MISSING'
          : isMerchantMissing
            ? 'MERCHANT_NOT_FOUND'
            : 'MERCHANT_LOOKUP_FAILED'
      );
    }
    merchantSender = merchantSenderResult.sender;
  }
  const resolvedQuote = await refreshOrderShipmentQuote(
    supabase,
    bookingQuote,
    shippingProvider,
    merchantSender,
    {
      orderId: orderWithEconomics.id,
      ...(orderWithEconomics.shipping_funding_source === 'merchant_wallet'
        ? { allowRefresh: false }
        : { expectedShippingFee: orderWithEconomics.shipping_fee }),
    }
  );
  if (orderWithEconomics.shipping_funding_source !== 'merchant_wallet') {
    assertQuotePriceMatchesOrderFee(
      resolvedQuote,
      orderWithEconomics.shipping_fee
    );
  }
  const resolvedQuoteRequest = parseStoredQuoteRequest(
    resolvedQuote.quote_request
  );
  const effectiveQuoteRequest = resolvedQuoteRequest ?? storedQuoteRequest;
  const bookingContext = resolveAdminGiglBookingContext(
    shippingProvider,
    orderWithEconomics,
    effectiveQuoteRequest
  );
  if (isInternationalQuote && effectiveQuoteRequest) {
    assertInternationalQuoteMatchesOrder(
      effectiveQuoteRequest,
      orderWithEconomics
    );
  } else if (effectiveQuoteRequest) {
    assertQuoteReceiverMatchesOrder(effectiveQuoteRequest, orderWithEconomics);
    assertQuoteItemsMatchOrder(
      effectiveQuoteRequest,
      toQuoteComparableOrderItems(orderWithEconomics.order_items, {
        defaultWeight: bookingContext.defaultWeight,
      })
    );
  }
  const receiver =
    isInternationalQuote && effectiveQuoteRequest
      ? {
          ...effectiveQuoteRequest.receiver,
          name: bookingContext.receiver.name,
          email: bookingContext.receiver.email,
          phone: bookingContext.receiver.phone,
        }
      : bookingContext.receiver;
  const sender =
    isInternationalQuote && effectiveQuoteRequest?.sender
      ? effectiveQuoteRequest.sender
      : merchantSender;
  if (!sender) {
    throw new OrderShipmentBookingError(
      'The saved international shipping quote is missing its sender. Please get a new quote before shipping.',
      400,
      'INTERNATIONAL_QUOTE_SENDER_MISSING'
    );
  }
  const items =
    isInternationalQuote && effectiveQuoteRequest
      ? toInternationalShipmentItemsFromOrder(
          orderItems,
          effectiveQuoteRequest.items
        )
      : toDomesticBookingItems(orderItems, effectiveQuoteRequest?.items);
  const result = await shippingService.bookShipment(
    shippingProvider,
    buildOrderShipmentBookingRequest({
      items,
      orderId: orderWithEconomics.id,
      quote: resolvedQuote,
      receiver,
      sender,
    })
  );
  const { shipmentId } = await persistBookedOrderShipment(supabase, {
    merchantId,
    orderId: orderWithEconomics.id,
    quote: resolvedQuote,
    result,
    sender,
    receiver,
    items,
  });
  return {
    shipmentId,
    provider: result.provider,
    providerShipmentId: result.providerShipmentId,
    trackingNumber: result.trackingNumber,
    carrierName: result.carrierName,
    quoteId: resolvedQuote.id,
    estimatedDays: resolvedQuote.estimated_days,
    labelUrl: result.labelUrl,
    pickupScheduledAt: result.pickupScheduledAt,
    shipmentStatus: result.status,
  };
}
