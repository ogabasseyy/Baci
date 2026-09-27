export interface CalculateOrderTotalsInput {
  subtotal: number;
  shippingFee?: number;
  taxRate?: number;
}

export interface CalculateOrderTotalsResult {
  total: number;
  taxAmount: number;
}

/**
 * Preview the same order arithmetic as the calculate-commerce Edge Function.
 * The orders route remains authoritative and recomputes canonical per-line VAT.
 */
export function calculateOrderTotals({
  subtotal,
  shippingFee = 0,
  taxRate = 0.075,
}: CalculateOrderTotalsInput): CalculateOrderTotalsResult {
  const taxAmount = subtotal * taxRate;
  const total = subtotal + taxAmount + shippingFee;

  return {
    taxAmount: Math.round(taxAmount * 100) / 100,
    total: Math.round(total * 100) / 100,
  };
}
