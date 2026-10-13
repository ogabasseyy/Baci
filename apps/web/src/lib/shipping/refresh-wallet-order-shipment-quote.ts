import type { SupabaseClient } from '@supabase/supabase-js';
import { hasActiveMerchantShippingCharge } from './book-wallet-funded-reservation-cleanup';
import { assertQuoteItemsMatchOrder } from './international-quote-items-match';
import { assertQuoteReceiverMatchesOrder } from './international-quote-order-guard';
import {
  isShippingProviderCode,
  OrderShipmentBookingError,
  parseStoredQuoteRequest,
  toQuoteComparableOrderItems,
} from './order-shipment-booking-utils';
import {
  type OrderShipmentQuoteRecord,
  refreshOrderShipmentQuote,
} from './refresh-order-shipment-quote';
import { resolveBookingMerchantSender } from './resolve-booking-merchant-sender';
import {
  applyShippingQuoteBookingEconomicsToQuote,
  getShippingQuoteBookingEconomics,
} from './shipping-quote-booking-economics';
import { getShippingQuoteBookingMetadata } from './shipping-quote-booking-metadata';
import type { ShippingAddress } from './types';

/** Refresh an Admin wallet quote before reserving funds. */
export async function refreshWalletOrderShipmentQuote(
  supabase: SupabaseClient,
  merchantId: string,
  orderId: string,
  quoteId: string
): Promise<string> {
  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select(
      'id, selected_quote_id, shipping_provider, shipping_address, order_items(name, quantity, price, product:products!order_items_product_id_fkey(weight_value, weight_unit, dimensions))'
    )
    .eq('id', orderId)
    .eq('merchant_id', merchantId)
    .single();
  if (orderError || !order) {
    throw new OrderShipmentBookingError(
      'Order not found',
      404,
      'ORDER_NOT_FOUND'
    );
  }
  if (order.selected_quote_id !== quoteId) {
    throw new OrderShipmentBookingError(
      'The shipping quote no longer matches this order.',
      409,
      'QUOTE_ORDER_MISMATCH'
    );
  }
  if (!isShippingProviderCode(order.shipping_provider)) {
    throw new OrderShipmentBookingError(
      'This order is not configured for provider-backed shipping.',
      400,
      'INVALID_SHIPPING_PROVIDER'
    );
  }

  const { data: storedQuote, error: quoteError } = await supabase
    .from('shipping_quotes')
    .select(
      'id, merchant_id, provider, service_tier, carrier_name, price, currency, estimated_days, provider_rate_id, expires_at, quote_request'
    )
    .eq('id', quoteId)
    .eq('merchant_id', merchantId)
    .single();
  if (quoteError || !storedQuote) {
    throw new OrderShipmentBookingError(
      'The saved shipping quote could not be found.',
      404,
      'QUOTE_NOT_FOUND'
    );
  }

  const request = parseStoredQuoteRequest(storedQuote.quote_request);
  if (!request) {
    throw new OrderShipmentBookingError(
      'The saved shipping quote has expired and cannot be refreshed.',
      400,
      'QUOTE_REFRESH_UNAVAILABLE'
    );
  }
  // Wallet reservation happens after this prepare step. Reject a destination
  // change here so the attested tariff cannot debit the wallet for a later
  // receiver that the generic order update path still allows.
  assertQuoteReceiverMatchesOrder(request, order);
  assertQuoteItemsMatchOrder(
    request,
    toQuoteComparableOrderItems(order.order_items, { defaultWeight: 1 })
  );

  const metadata = await getShippingQuoteBookingMetadata(
    supabase,
    merchantId,
    orderId,
    quoteId
  );
  const bookingEconomics = await getShippingQuoteBookingEconomics(
    supabase,
    merchantId,
    orderId,
    quoteId
  );
  const quote = applyShippingQuoteBookingEconomicsToQuote(
    {
      ...storedQuote,
      provider_metadata: metadata,
    },
    bookingEconomics
  ) as OrderShipmentQuoteRecord;
  let sender: ShippingAddress | undefined;
  if (request.shipmentType === 'domestic') {
    const senderResult = await resolveBookingMerchantSender(
      supabase,
      merchantId
    );
    if (!senderResult.ok) {
      throw new OrderShipmentBookingError(
        senderResult.error,
        senderResult.status,
        'MERCHANT_SENDER_REQUIRED'
      );
    }
    sender = senderResult.sender;
  }

  // Reserved/provider_submitting charges already hold the attested quote.
  // refreshOrderShipmentQuote can persist a replacement quote id through its
  // proof-bound RPC; skip that path so resume stays on the reserved quote.
  const activeCharge = await hasActiveMerchantShippingCharge(
    supabase,
    orderId,
    quoteId
  );
  if (activeCharge !== false) {
    return quoteId;
  }

  const refreshed = await refreshOrderShipmentQuote(
    supabase,
    quote,
    order.shipping_provider,
    sender,
    { orderId }
  );
  const previousPrice = Number(storedQuote.price);
  const nextPrice = Number(refreshed.price);
  const quoteChanged =
    refreshed.id !== quoteId ||
    (Number.isFinite(previousPrice) &&
      Number.isFinite(nextPrice) &&
      previousPrice !== nextPrice);
  if (!quoteChanged) return quoteId;

  const { error: updateError } = await supabase
    .from('orders')
    .update({ selected_quote_id: refreshed.id })
    .eq('id', orderId)
    .eq('merchant_id', merchantId)
    .eq('selected_quote_id', quoteId);
  if (updateError) {
    throw new OrderShipmentBookingError(
      'Failed to attach the refreshed shipping quote to this order.',
      500,
      'QUOTE_REFRESH_ORDER_UPDATE_FAILED'
    );
  }
  throw new OrderShipmentBookingError(
    'The shipping quote changed or expired. Please get a new quote and confirm shipping before booking.',
    409,
    'MERCHANT_WALLET_QUOTE_RECONFIRM_REQUIRED'
  );
}
