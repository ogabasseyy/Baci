import {
  roundCurrency,
  SERVER_ASSURANCE_RATE,
} from '@/lib/immediate-order/order-item-primitives';

export type OfferAssuranceLine = {
  product_id?: string | null;
  offer_id?: string | null;
  has_assurance?: boolean | null;
  assurance_fee?: number;
  quantity: number;
};

type NegotiationLineDiscounts =
  | {
      lineDiscounts?: Array<{
        merchandiseDiscount?: number | null;
      } | null> | null;
    }
  | null
  | undefined;

/**
 * Recomputes offer-line assurance fees from the server-validated charged
 * unit price: the live offer price minus the validated per-unit
 * merchandise reduction, and only when that reduction is actually applied
 * to the order. The order call charges live merchandise but stages the
 * route fee, so a zero/stale client price naming a valid offer must not
 * set the fee — while an approved negotiated price must not be
 * overcharged either. lineDiscounts is positional with the payload (null
 * entries for lines without a reduction).
 */
export function recomputeOfferAssuranceFees(
  lines: OfferAssuranceLine[],
  liveOfferPrices: Map<string, number>,
  discount: {
    applied: boolean;
    negotiation: NegotiationLineDiscounts;
  }
): void {
  if (liveOfferPrices.size === 0) return;
  lines.forEach((line, index) => {
    if (!line.offer_id || !line.has_assurance) return;
    const livePrice = liveOfferPrices.get(
      `${line.product_id}::${line.offer_id}`
    );
    if (livePrice === undefined) return;
    const validatedReduction = discount.applied
      ? (discount.negotiation?.lineDiscounts?.[index]?.merchandiseDiscount ?? 0)
      : 0;
    const chargedUnit =
      livePrice - validatedReduction / Math.max(line.quantity, 1);
    line.assurance_fee = roundCurrency(
      Math.max(chargedUnit, 0) * line.quantity * SERVER_ASSURANCE_RATE
    );
  });
}
