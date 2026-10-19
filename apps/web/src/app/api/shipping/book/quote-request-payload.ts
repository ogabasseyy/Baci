import {
  assertInternationalQuoteMatchesOrder,
  type InternationalQuoteOrder,
} from '@/lib/shipping/international-quote-order-guard';
import {
  type InternationalShipmentOrderItem,
  toInternationalShipmentItemsFromOrder,
} from '@/lib/shipping/international-shipment-items';
import {
  OrderShipmentBookingError,
  parseStoredQuoteRequest,
} from '@/lib/shipping/order-shipment-booking-utils';
import { isGiglInternationalProviderRate } from '@/lib/shipping/providers/gigl.international-payload';
import type {
  QuoteRequest,
  ShipmentItem,
  ShippingAddress,
} from '@/lib/shipping/types';

type BookingQuoteRecord = {
  provider: string | null;
  provider_rate_id: string | null;
  quote_request?: unknown;
};

type QuoteRequestPayload = {
  items: ShipmentItem[];
  receiver: ShippingAddress;
  sender?: ShippingAddress;
  storedQuoteRequest?: QuoteRequest;
  validationError?: BookingQuoteValidation;
};

export type BookingQuoteValidation =
  | { ok: true }
  | { code: string; error: string; ok: false; status: number };

export function resolveBookingQuoteRequestPayload(
  quote: BookingQuoteRecord,
  receiver: ShippingAddress,
  items: ShipmentItem[],
  orderItems: InternationalShipmentOrderItem[] = []
): QuoteRequestPayload | null {
  const isGiglInternationalQuote = isGiglInternationalProviderRate(
    quote.provider,
    quote.provider_rate_id
  );
  const storedQuoteRequest = parseStoredQuoteRequest(quote.quote_request);
  const isInternationalQuote =
    isGiglInternationalQuote ||
    storedQuoteRequest?.shipmentType === 'international';

  if (!isInternationalQuote) {
    return { items, receiver };
  }

  if (!storedQuoteRequest) {
    return null;
  }

  let resolvedItems: ShipmentItem[] = [];
  let validationError: BookingQuoteValidation | undefined;
  try {
    resolvedItems = toInternationalShipmentItemsFromOrder(
      orderItems,
      storedQuoteRequest.items
    );
  } catch (error) {
    if (error instanceof OrderShipmentBookingError) {
      validationError = {
        ok: false,
        error: error.message,
        code: error.code,
        status: error.status,
      };
    } else {
      throw error;
    }
  }

  return {
    items: resolvedItems,
    receiver: {
      ...storedQuoteRequest.receiver,
      name: receiver.name,
      email: receiver.email,
      phone: receiver.phone,
    },
    sender: storedQuoteRequest.sender,
    storedQuoteRequest,
    validationError,
  };
}

export function validateBookingQuoteRequestPayload(
  payload: QuoteRequestPayload,
  order: InternationalQuoteOrder,
  expectedMerchantId?: string
): BookingQuoteValidation {
  if (!payload.storedQuoteRequest) {
    return { ok: true };
  }
  if (
    payload.storedQuoteRequest.shipmentType === 'international' &&
    !payload.storedQuoteRequest.sender
  ) {
    return {
      ok: false,
      error:
        'The saved international shipping quote is missing its sender. Please get a new quote before shipping.',
      code: 'INTERNATIONAL_QUOTE_SENDER_MISSING',
      status: 400,
    };
  }
  if (payload.validationError) {
    return payload.validationError;
  }
  const storedMerchantId = payload.storedQuoteRequest.merchantId;
  if (
    expectedMerchantId &&
    storedMerchantId &&
    storedMerchantId !== expectedMerchantId
  ) {
    return {
      ok: false,
      error:
        'The saved international shipping quote no longer matches this order. Please get a new quote before shipping.',
      code: 'INTERNATIONAL_QUOTE_MERCHANT_MISMATCH',
      status: 400,
    };
  }

  try {
    assertInternationalQuoteMatchesOrder(payload.storedQuoteRequest, order);
    return { ok: true };
  } catch (error) {
    if (error instanceof OrderShipmentBookingError) {
      return {
        ok: false,
        error: error.message,
        code: error.code,
        status: error.status,
      };
    }
    throw error;
  }
}
