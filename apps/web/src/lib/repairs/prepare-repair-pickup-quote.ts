import type {
  QuoteRequest,
  ShipmentItem,
  ShippingAddress,
  ShippingQuote,
} from '@/lib/shipping/types';
import { isRepairPickupQuoteAbovePaidFee } from './is-repair-pickup-payment-ready';
import { quoteRepairPickup } from './quote-repair-pickup';
import type { RepairCenterAddress } from './repair-center-address';
import { repriceRepairPickupQuoteForPaidFee } from './reprice-repair-pickup-quote-for-paid-fee';

export type PreparedRepairPickupQuote =
  | { ok: true; quote: ShippingQuote; request: QuoteRequest }
  | { ok: false; reason: 'gigl_unavailable' | 'quote_increased' };

/**
 * Fetch a fresh GIG quote for a paid repair pickup and check it against the
 * fee the customer paid. Pickups paid before NGN 100 rounding keep their
 * price unless GIG's cost rose above it.
 */
export async function prepareRepairPickupQuote(input: {
  items: ShipmentItem[];
  merchantId: string;
  receiver: RepairCenterAddress;
  sender: ShippingAddress;
  paidPickupFee: number | string | null | undefined;
}): Promise<PreparedRepairPickupQuote> {
  const { paidPickupFee, ...quoteInput } = input;
  let result: Awaited<ReturnType<typeof quoteRepairPickup>>;
  try {
    result = await quoteRepairPickup(quoteInput);
  } catch (error) {
    console.error('Repair pickup quote failed:', error);
    return { ok: false, reason: 'gigl_unavailable' };
  }
  if (!result.quote) {
    return { ok: false, reason: 'gigl_unavailable' };
  }
  const quote = repriceRepairPickupQuoteForPaidFee(result.quote, paidPickupFee);
  if (isRepairPickupQuoteAbovePaidFee(quote.price, paidPickupFee ?? null)) {
    return { ok: false, reason: 'quote_increased' };
  }
  return { ok: true, quote, request: result.request };
}
