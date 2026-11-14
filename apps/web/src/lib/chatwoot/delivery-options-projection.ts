import 'server-only';

import { isMajorAmountRepresentable } from '@/lib/money/is-major-amount-representable';
import type { ShippingQuote } from '@/lib/shipping/types';
import type { ChatwootDeliveryOptionsResponse } from '@/schemas/chatwoot-delivery-options';

const MAX_DELIVERY_OPTIONS = 20;

function boundedText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().slice(0, maxLength);
  return normalized || undefined;
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
      quote.currency.trim().toUpperCase() !== input.currency
    ) {
      droppedInvalidQuote = true;
      continue;
    }

    const pickupLocation = quote.isStationPickup
      ? boundedText(
          [quote.stationName, quote.stationAddress]
            .filter((part): part is string => typeof part === 'string')
            .join(' · '),
          240
        )
      : undefined;
    const pickupInstructions = quote.isStationPickup
      ? boundedText(quote.stationInstructions, 240)
      : undefined;

    options.push({
      displayName,
      priceMajor: quote.price,
      currency: input.currency,
      ...(Number.isInteger(quote.estimatedDays) &&
      quote.estimatedDays >= 0 &&
      quote.estimatedDays <= 365
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
