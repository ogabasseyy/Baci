import type { SupabaseClient } from '@supabase/supabase-js';
import { shippingService } from '@/lib/shipping';
import { assertCurrentOrderPaymentShippable } from '@/lib/shipping/assert-current-shippable-order-payment';
import {
  assertShippableBookingItems,
  isShippingProviderCode,
  type OrderItemRecord,
  OrderShipmentBookingError,
  parseStoredQuoteRequest,
  toDomesticBookingItems,
} from '@/lib/shipping/order-shipment-booking-utils';
import type { OrderShipmentQuoteRecord } from '@/lib/shipping/refresh-order-shipment-quote';
import { resolveBookingMerchantSender } from '@/lib/shipping/resolve-booking-merchant-sender';
import type {
  BookingRequest,
  ShipmentBookingResult,
  ShipmentItem,
  ShippingAddress,
} from '@/lib/shipping/types';
import { resolveBookingQuoteForSender } from './resolve-booking-quote-for-sender';

type DirectBookingPayload = {
  receiver: ShippingAddress;
  items: ShipmentItem[];
  sender?: ShippingAddress;
};

function normalizeText(value: string | undefined): string {
  return (value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function addressesMatch(
  left: ShippingAddress,
  right: ShippingAddress
): boolean {
  const textFields: (keyof ShippingAddress)[] = [
    'name',
    'phone',
    'email',
    'address',
    'city',
    'state',
    'country',
    'countryCode',
    'postalCode',
    'stationName',
  ];
  return (
    textFields.every(
      (field) =>
        normalizeText(left[field] as string | undefined) ===
        normalizeText(right[field] as string | undefined)
    ) &&
    left.latitude === right.latitude &&
    left.longitude === right.longitude &&
    left.stationId === right.stationId
  );
}

function itemsMatch(left: ShipmentItem[], right: ShipmentItem[]): boolean {
  if (left.length !== right.length) return false;
  const unmatched = [...right];
  return left.every((item) => {
    const index = unmatched.findIndex(
      (candidate) =>
        normalizeText(candidate.name) === normalizeText(item.name) &&
        candidate.quantity === item.quantity &&
        candidate.weight === item.weight &&
        candidate.value === item.value &&
        normalizeText(candidate.category) === normalizeText(item.category) &&
        normalizeText(candidate.hsCode) === normalizeText(item.hsCode) &&
        candidate.length === item.length &&
        candidate.width === item.width &&
        candidate.height === item.height &&
        normalizeText(candidate.description) === normalizeText(item.description)
    );
    if (index === -1) return false;
    unmatched.splice(index, 1);
    return true;
  });
}

function assertDomesticQuoteMatchesPayload(
  receiver: ShippingAddress,
  items: ShipmentItem[],
  payload: DirectBookingPayload
): void {
  if (
    addressesMatch(receiver, payload.receiver) &&
    itemsMatch(items, payload.items)
  ) {
    return;
  }
  throw new OrderShipmentBookingError(
    'The saved shipping quote no longer matches this order. Please get a new quote before shipping.',
    400,
    'DOMESTIC_QUOTE_ORDER_MISMATCH'
  );
}

export async function executeDirectBookingAttempt(params: {
  supabase: SupabaseClient;
  merchantId: string;
  merchantBusinessName?: string | null;
  orderId: string;
  quote: OrderShipmentQuoteRecord;
  quotePayload: DirectBookingPayload;
  usesStoredInternationalSender: boolean;
  expectedShippingFee?: number | string | null;
  instructions?: string;
  onProviderAttempt?: () => void;
}): Promise<{
  bookingQuote: OrderShipmentQuoteRecord;
  items: ShipmentItem[];
  receiver: ShippingAddress;
  result: ShipmentBookingResult;
  senderInfo: ShippingAddress;
}> {
  const {
    supabase,
    merchantId,
    merchantBusinessName,
    orderId,
    quote,
    quotePayload,
    usesStoredInternationalSender,
    expectedShippingFee,
    instructions,
    onProviderAttempt,
  } = params;

  if (!isShippingProviderCode(quote.provider)) {
    throw new OrderShipmentBookingError(
      'Invalid shipping provider in quote',
      400,
      'INVALID_SHIPPING_PROVIDER'
    );
  }

  let merchantSender: ShippingAddress | undefined;
  if (!usesStoredInternationalSender) {
    const merchantSenderResult = await resolveBookingMerchantSender(
      supabase,
      merchantId,
      merchantBusinessName
    );
    if (!merchantSenderResult.ok) {
      throw new OrderShipmentBookingError(
        merchantSenderResult.error,
        merchantSenderResult.status,
        'MERCHANT_SENDER_REQUIRED'
      );
    }
    merchantSender = merchantSenderResult.sender;
  }

  const bookingQuote = await resolveBookingQuoteForSender(
    supabase,
    quote,
    quote.provider,
    {
      orderId,
      merchantSender,
      usesStoredInternationalSender,
      expectedShippingFee,
    }
  );

  const senderInfo = quotePayload.sender ?? merchantSender;
  if (!senderInfo) {
    throw new OrderShipmentBookingError(
      'Registered merchant sender is required for domestic shipment booking.',
      400,
      'MERCHANT_SENDER_REQUIRED'
    );
  }

  const refreshedRequest = usesStoredInternationalSender
    ? null
    : parseStoredQuoteRequest(bookingQuote.quote_request);
  const receiver =
    refreshedRequest?.shipmentType === 'domestic'
      ? refreshedRequest.receiver
      : quotePayload.receiver;
  const items =
    refreshedRequest?.shipmentType === 'domestic'
      ? refreshedRequest.items
      : quotePayload.items;
  if (refreshedRequest?.shipmentType === 'domestic') {
    assertDomesticQuoteMatchesPayload(receiver, items, quotePayload);
  }

  // Re-read the authoritative order rows after the claim: the loaded
  // snapshot predates it, and a partial refund that settled (processed +
  // released) in between is deliberately allowed by the claim while
  // still leaving stale pre-refund fulfillment quantities behind.
  // The claim's lock token blocks any newer refund from reserving, so
  // the rows read here are stable through provider submission.
  const { data: currentOrderItems, error: currentOrderItemsError } =
    await supabase
      .from('order_items')
      .select('name, quantity, price, fulfillment_data')
      .eq('order_id', orderId);
  if (currentOrderItemsError || !currentOrderItems) {
    throw new OrderShipmentBookingError(
      'Could not verify the current shippable quantities for this order.',
      500,
      'SHIPMENT_BOOKING_STATE_CHECK_FAILED'
    );
  }
  // Rebuild the provider items from the authoritative order rows: partial
  // refunds write the surviving per-line quantity into
  // order_items.fulfillment_data, and quoting predates the refund, so the
  // stored/client items above would otherwise ship refunded units.
  const shippableItems = toDomesticBookingItems(
    currentOrderItems as OrderItemRecord[],
    items
  );
  assertShippableBookingItems(shippableItems);

  const bookingRequest: BookingRequest = {
    orderId,
    quoteId: bookingQuote.id,
    providerRateId: bookingQuote.provider_rate_id || undefined,
    quoteMetadata: bookingQuote.provider_metadata,
    sender: senderInfo,
    receiver,
    items: shippableItems,
    instructions,
  };

  // Fresh payment-state check serialized against refund finalization:
  // the loaded order snapshot predates quote resolution, so a full refund
  // could have landed since.
  await assertCurrentOrderPaymentShippable(supabase, merchantId, orderId);
  onProviderAttempt?.();
  const result = await shippingService.bookShipment(
    quote.provider,
    bookingRequest
  );

  return { bookingQuote, items: shippableItems, receiver, result, senderInfo };
}
