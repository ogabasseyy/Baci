'use client';

import { calculateOrderTotals } from '@/lib/checkout/calculate-order-totals';

interface UseOrderTotalsOptions {
  cartTotal: number;
  deliveryCost: number;
  taxRate: number;
}

export function useOrderTotals({
  cartTotal,
  deliveryCost,
  taxRate,
}: UseOrderTotalsOptions) {
  return calculateOrderTotals({
    subtotal: cartTotal,
    shippingFee: deliveryCost,
    taxRate,
  });
}
