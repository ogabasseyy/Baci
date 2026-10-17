import { normalizePhoneToE164 } from '@baci/shared/lib';
import { shippingService } from '@/lib/shipping';
import { normalizeReceiverMatchText } from './international-quote-receiver-match';
import { matchesGiglProviderRate } from './matches-gigl-provider-rate';
import { domesticSendersDiffer } from './merchant-sender-comparison';
import {
  OrderShipmentBookingError,
  parseStoredQuoteRequest,
} from './order-shipment-booking-utils';
import { parseGiglProviderRateId } from './providers/gigl.constants';
import type { OrderShipmentQuoteRecord } from './refresh-order-shipment-quote';
import type { ShippingAddress, ShippingQuote } from './types';

function reconfirm(): never {
  throw new OrderShipmentBookingError(
    'Shipping details, service or cost changed. Review and confirm the shipping destination and quote before booking.',
    409,
    'SHIPPING_QUOTE_RECONFIRM_REQUIRED'
  );
}
function sameAmount(
  actual: number | string | null | undefined,
  expected: number | string | null | undefined
): boolean {
  if (actual == null || expected == null || actual === '' || expected === '')
    return false;
  const a = Number(actual);
  const b = Number(expected);
  return (
    Number.isFinite(a) &&
    Number.isFinite(b) &&
    Math.round(a * 100) === Math.round(b * 100)
  );
}

/** Legacy rates may omit origin; explicit saved origins must remain identical. */
function matchesSavedRate(
  saved: string | null,
  candidate: string | undefined
): boolean {
  if (!saved || !candidate) return false;
  if (saved === candidate) return true;
  if (!matchesGiglProviderRate(saved, candidate)) return false;
  const origin = parseGiglProviderRateId(saved).senderStationId;
  return (
    origin === undefined ||
    origin === parseGiglProviderRateId(candidate).senderStationId
  );
}

/** Price-only preflight: never changes the paid order, saved quote or consent. */
export async function validateSavedGiglCheckoutQuote(
  quote: OrderShipmentQuoteRecord,
  sender: ShippingAddress | undefined,
  expectedFee: number | string | null | undefined
): Promise<OrderShipmentQuoteRecord> {
  const request = parseStoredQuoteRequest(quote.quote_request);
  if (
    quote.provider !== 'GIGL' ||
    request?.shipmentType !== 'domestic' ||
    !request.sender ||
    !sender ||
    domesticSendersDiffer(request.sender, sender) ||
    normalizeReceiverMatchText(request.sender.name) !==
      normalizeReceiverMatchText(sender.name) ||
    normalizePhoneToE164(request.sender.phone) === null ||
    normalizePhoneToE164(request.sender.phone) !==
      normalizePhoneToE164(sender.phone) ||
    normalizeReceiverMatchText(request.sender.address) !==
      normalizeReceiverMatchText(sender.address) ||
    normalizeReceiverMatchText(request.sender.postalCode) !==
      normalizeReceiverMatchText(sender.postalCode) ||
    quote.pricing_version !== 'gigl_platform_margin_v1' ||
    !sameAmount(quote.price, expectedFee) ||
    quote.provider_cost == null ||
    !Number.isFinite(quote.provider_cost) ||
    quote.provider_cost <= 0
  )
    reconfirm();
  let quotes: ShippingQuote[];
  try {
    quotes = await shippingService.getProviderQuotes('GIGL', {
      ...request,
      sessionId: crypto.randomUUID(),
    });
  } catch {
    throw new OrderShipmentBookingError(
      'Could not check the current shipping price. No booking was submitted. Please try again.',
      409,
      'QUOTE_REFRESH_FAILED'
    );
  }
  if (!Array.isArray(quotes) || quotes.length === 0) {
    throw new OrderShipmentBookingError(
      'Could not verify the current shipping price. No booking was submitted. Please try again.',
      409,
      'QUOTE_REFRESH_FAILED'
    );
  }
  const matching = quotes.find(
    (candidate) =>
      candidate.provider === 'GIGL' &&
      candidate.currency === quote.currency &&
      candidate.serviceTier === quote.service_tier &&
      candidate.carrierName === quote.carrier_name &&
      matchesSavedRate(quote.provider_rate_id, candidate.providerRateId) &&
      sameAmount(candidate.price, quote.price) &&
      sameAmount(candidate.providerCost, quote.provider_cost) &&
      sameAmount(candidate.platformMargin, quote.platform_margin) &&
      candidate.pricingVersion === quote.pricing_version
  );
  if (!matching) reconfirm();
  return quote;
}
