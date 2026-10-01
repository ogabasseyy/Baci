import { OrderShipmentBookingError } from '@/lib/shipping/order-shipment-booking-utils';

function parseAmount(value: number | string | null | undefined): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

export function assertQuotePriceMatchesOrderFee(
  quote: { price: number | string },
  expectedShippingFee: number | string | null | undefined
): void {
  if (expectedShippingFee === null || expectedShippingFee === undefined) {
    return;
  }

  const quotePrice = parseAmount(quote.price);
  const orderFee = parseAmount(expectedShippingFee);

  if (
    quotePrice === null ||
    orderFee === null ||
    Math.abs(quotePrice - orderFee) > 0.01
  ) {
    throw new OrderShipmentBookingError(
      'The shipping price changed. Please get a new shipping quote before shipping.',
      400,
      'QUOTE_PRICE_CHANGED'
    );
  }
}
