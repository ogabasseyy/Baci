import type { DeliveryMethod, ResumedOrder } from './types';

interface DeriveCheckoutSummaryAmountsInput {
  deliveryCost: number;
  deliveryMethod: DeliveryMethod | null;
  discountAmount: number;
  giftWrappingCost: number;
  hasCheckoutCartItems: boolean;
  orderTotals: { total: number; taxAmount: number } | null;
  resumedOrder: ResumedOrder | null;
}

/** Projects persisted resumed-order amounts into the summary display fields. */
export function deriveCheckoutSummaryAmounts({
  deliveryCost,
  deliveryMethod,
  discountAmount,
  giftWrappingCost,
  hasCheckoutCartItems,
  orderTotals,
  resumedOrder,
}: DeriveCheckoutSummaryAmountsInput) {
  const summaryOrder = hasCheckoutCartItems ? null : resumedOrder;
  const summaryTaxAmount = summaryOrder
    ? (summaryOrder.tax_amount ?? 0)
    : (orderTotals?.taxAmount ?? 0);

  return {
    summaryOrder,
    summaryTaxAmount,
    summaryDeliveryCost: summaryOrder
      ? (summaryOrder.shipping_cost ?? 0)
      : deliveryCost,
    summaryGiftWrappingCost: summaryOrder
      ? (summaryOrder.gift_wrapping_fee ?? 0)
      : giftWrappingCost,
    summaryDiscountAmount: summaryOrder
      ? (summaryOrder.discount_amount ?? 0)
      : discountAmount,
    summaryDeliveryMethod: summaryOrder ? null : deliveryMethod,
    summaryOrderTotals: summaryOrder
      ? { total: summaryOrder.total, taxAmount: summaryTaxAmount }
      : orderTotals,
    // The persisted amount may have been calculated with a historical or
    // merchant-specific rate, so do not attach the current default rate.
    summaryTaxLabel: summaryOrder ? 'Tax' : 'VAT (7.5%)',
  };
}
