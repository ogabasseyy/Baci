import { NextResponse } from 'next/server';
import type { ShippingQuote } from '@/lib/shipping/types';
import { toPublicQuoteResponse } from './public-quote-response';

export function selectEligibleAdminGiglQuote(quotes: ShippingQuote[]) {
  return (
    quotes
      .filter(
        (quote) =>
          quote.provider === 'GIGL' &&
          quote.currency === 'NGN' &&
          !quote.isStationPickup &&
          quote.price > 0
      )
      .sort((a, b) => a.price - b.price)[0] ?? null
  );
}

export function calculateAdminWalletFunding(price: number, balance: number) {
  const availableBalance = Math.max(0, Number.isFinite(balance) ? balance : 0);
  const shortfall = Math.max(0, price - availableBalance);
  return { availableBalance, shortfall, canBook: shortfall === 0 };
}

export function toAdminPublicQuote(quote: ShippingQuote) {
  return toPublicQuoteResponse({
    quotes: { featured: [quote], all: [quote] },
    sessionId: quote.id,
    expiresAt: quote.expiresAt.toISOString(),
  }).quotes.featured[0];
}

export function getAdminPartnerDeliveryConflict(message: string | undefined) {
  const conflicts = {
    partner_delivery_destination_changed: {
      code: 'PARTNER_DELIVERY_DESTINATION_CHANGED',
      error: 'Use the destination on the paid partner quote.',
    },
    partner_delivery_origin_or_parcel_changed: {
      code: 'PARTNER_DELIVERY_ORIGIN_OR_PARCEL_CHANGED',
      error: 'The pickup origin or parcel differs from the paid partner quote.',
    },
    partner_delivery_service_changed: {
      code: 'PARTNER_DELIVERY_SERVICE_CHANGED',
      error:
        'The current GIG service differs from the settled delivery quote. Review the service before booking.',
    },
  };
  if (!message || !Object.hasOwn(conflicts, message)) return null;
  return NextResponse.json(conflicts[message as keyof typeof conflicts], {
    status: 409,
  });
}
