import 'server-only';

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
    input.quotes.length > MAX_DELIVERY_OPTIONS ||
    !/^[A-Z]{3}$/.test(input.currency) ||
    !Number.isSafeInteger(input.cartVersion) ||
    input.cartVersion < 0 ||
    !Number.isSafeInteger(input.subtotalMinor) ||
    input.subtotalMinor < 0
  ) {
    return null;
  }

  const options: ChatwootDeliveryOptionsResponse['options'] = [];
  for (const quote of input.quotes) {
    const displayName = boundedText(quote.displayName, 120);
    if (
      quote.provider !== 'MERCHANT' ||
      !displayName ||
      !Number.isFinite(quote.price) ||
      quote.price < 0 ||
      !Number.isSafeInteger(quote.price * 100) ||
      quote.currency.trim().toUpperCase() !== input.currency
    ) {
      return null;
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

  return {
    state: input.state,
    cartVersion: input.cartVersion,
    currency: input.currency,
    subtotalMinor: input.subtotalMinor,
    options,
  };
}
