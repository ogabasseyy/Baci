import { COMPACT_OPTIONS, formatCurrency } from '@/lib/currency';
import { logger } from '@/lib/logger';
import { OrderShipmentBookingError } from './order-shipment-booking-error';
import type { OrderShipmentQuoteRecord } from './refresh-order-shipment-quote';
import type { ShippingQuote } from './types';

/** GIG's live cost for the paid service is more than the customer paid. */
export const GIGL_COST_EXCEEDS_CUSTOMER_PAID =
  'GIGL_COST_EXCEEDS_CUSTOMER_PAID';

const EXACT_MINOR_UNITS = {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
} as const satisfies Partial<Intl.NumberFormatOptions>;

type SavedCheckoutQuote = Pick<
  OrderShipmentQuoteRecord,
  'id' | 'merchant_id' | 'price' | 'currency'
>;

function toMinorUnits(value: number | string | null | undefined) {
  if (value == null || value === '') return null;
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0
    ? Math.round(amount * 100)
    : null;
}

function formatAmount(minorUnits: number, currency: string): string {
  const amount = minorUnits / 100;
  return formatCurrency(
    amount,
    null,
    Number.isInteger(amount) ? COMPACT_OPTIONS : EXACT_MINOR_UNITS,
    currency
  );
}

/**
 * Covered rule for a paid checkout quote: Baci books at the price the customer
 * already paid when GIG's live cost for the same service is no more than that
 * price. GIG's cost and Baci's margin are internal booking economics, so they
 * never enter logs or errors; only the verdict, ids, currency and the price
 * the customer paid are logged for reconciliation.
 */
export function assertSavedGiglCheckoutPriceCovered(
  quote: SavedCheckoutQuote,
  candidates: readonly Pick<ShippingQuote, 'providerCost'>[]
): void {
  const paid = toMinorUnits(quote.price);
  const liveCosts = candidates.map((candidate) =>
    toMinorUnits(candidate.providerCost)
  );
  if (
    paid === null ||
    liveCosts.length === 0 ||
    !liveCosts.every((cost): cost is number => cost !== null)
  ) {
    throw new OrderShipmentBookingError(
      'Could not verify the current shipping price. No booking was submitted. Please try again.',
      409,
      'QUOTE_REFRESH_FAILED'
    );
  }
  // Duplicate live rows for one service are unexpected; trust the dearest.
  const covered = Math.max(...liveCosts) <= paid;
  (covered ? logger.info : logger.warn)({
    message: 'Saved GIG checkout quote price check',
    quoteId: quote.id,
    merchantId: quote.merchant_id,
    currency: quote.currency,
    paidPrice: paid / 100,
    covered,
  });
  if (covered) return;
  throw new OrderShipmentBookingError(
    `GIG's current price for this delivery is higher than the ${formatAmount(paid, quote.currency)} the customer paid. No booking was made.`,
    409,
    GIGL_COST_EXCEEDS_CUSTOMER_PAID
  );
}
