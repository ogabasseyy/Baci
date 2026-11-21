import 'server-only';

import { isMajorAmountRepresentable } from '@/lib/money/is-major-amount-representable';
import type { ShippingQuote } from '@/lib/shipping/types';
import type { ChatwootDeliveryOptionsResponse } from '@/schemas/chatwoot-delivery-options';
import { formatChatwootPickupLocation } from './pickup-location';

const MAX_DELIVERY_OPTIONS = 20;

function boundedText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().slice(0, maxLength);
  return normalized || undefined;
}

/**
 * Merchant rates with no configured delivery days carry `estimatedDays: 0`
 * as an "unknown" sentinel. A real estimate always has min/max days or a range.
 */
function hasConfiguredEstimate(quote: ShippingQuote): boolean {
  if (
    !Number.isInteger(quote.estimatedDays) ||
    quote.estimatedDays < 0 ||
    quote.estimatedDays > 365
  ) {
    return false;
  }
  if (quote.estimatedDays > 0) return true;
  return (
    quote.minDays !== undefined ||
    quote.maxDays !== undefined ||
    Boolean(quote.deliveryRange)
  );
}

/** Keep only customer-facing merchant-rate estimate fields. */
export function projectChatwootDeliveryOptions(input: {
  state: string;
  cartVersion: number;
  currency: string;
  subtotalMinor: number;
  quotes: ShippingQuote[];
}): ChatwootDeliveryOptionsResponse | null {
  if (
    input.currency !== 'NGN' ||
    !Number.isSafeInteger(input.cartVersion) ||
    input.cartVersion < 0 ||
    !Number.isSafeInteger(input.subtotalMinor) ||
    input.subtotalMinor < 0
  ) {
    return null;
  }

  const options: ChatwootDeliveryOptionsResponse['options'] = [];
  let droppedInvalidQuote = false;
  for (const quote of input.quotes) {
    if (options.length >= MAX_DELIVERY_OPTIONS) break;
    const displayName = boundedText(quote.displayName, 120);
    if (
      quote.provider !== 'MERCHANT' ||
      !displayName ||
      !Number.isFinite(quote.price) ||
      quote.price < 0 ||
      !isMajorAmountRepresentable(quote.price, input.currency) ||
      typeof quote.currency !== 'string' ||
      quote.currency.trim().toUpperCase() !== input.currency
    ) {
      droppedInvalidQuote = true;
      continue;
    }

    const pickupLocation = formatChatwootPickupLocation(quote);
    const pickupInstructions = quote.isStationPickup
      ? boundedText(quote.stationInstructions, 240)
      : undefined;

    options.push({
      displayName,
      priceMajor: quote.price,
      currency: input.currency,
      ...(hasConfiguredEstimate(quote)
        ? { estimatedDays: quote.estimatedDays }
        : {}),
      pickup: quote.isStationPickup === true,
      ...(pickupLocation ? { pickupLocation } : {}),
      ...(pickupInstructions ? { pickupInstructions } : {}),
    });
  }

  if (droppedInvalidQuote && options.length === 0) return null;

  return {
    state: input.state,
    cartVersion: input.cartVersion,
    currency: input.currency,
    subtotalMinor: input.subtotalMinor,
    options,
  };
}
