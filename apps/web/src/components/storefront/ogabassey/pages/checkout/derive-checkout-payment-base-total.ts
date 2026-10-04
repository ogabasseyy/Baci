interface DeriveCheckoutPaymentBaseTotalInput {
  effectiveCheckoutCartTotal: number;
  deliveryCost: number;
  giftWrappingCost: number;
  hasCheckoutCartItems: boolean;
  taxAmount: number;
  resumedOrderTotal: number | null;
}

/** Uses the stamped all-in amount for resumed orders and live additions for carts. */
export function deriveCheckoutPaymentBaseTotal({
  effectiveCheckoutCartTotal,
  deliveryCost,
  giftWrappingCost,
  hasCheckoutCartItems,
  taxAmount,
  resumedOrderTotal,
}: DeriveCheckoutPaymentBaseTotalInput): number {
  if (!hasCheckoutCartItems && resumedOrderTotal !== null)
    return resumedOrderTotal;

  return (
    effectiveCheckoutCartTotal + deliveryCost + giftWrappingCost + taxAmount
  );
}
