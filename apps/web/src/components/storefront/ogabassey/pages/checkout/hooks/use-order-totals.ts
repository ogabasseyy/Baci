'use client';

import { useEffect, useState } from 'react';
import { calculateCommerce } from '@/lib/supabase/client';

interface OrderTotals {
  total: number;
  taxAmount: number;
}

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
  const [calculation, setCalculation] = useState<
    (UseOrderTotalsOptions & { totals: OrderTotals }) | null
  >(null);

  useEffect(() => {
    let active = true;
    const fetchTotals = async () => {
      try {
        const result = await calculateCommerce('calculate_order', {
          subtotal: cartTotal,
          shippingFee: deliveryCost,
          taxRate,
        });
        if (active) {
          setCalculation({ cartTotal, deliveryCost, taxRate, totals: result });
        }
      } catch (err) {
        if (active) console.error('Failed to fetch totals from brain', err);
      }
    };
    void fetchTotals();
    // Supabase's helper does not expose cancellation. Ignore obsolete results
    // so slower calculations cannot replace the current cart's tax amount.
    return () => {
      active = false;
    };
  }, [cartTotal, deliveryCost, taxRate]);

  // Invalidate during render, before an effect or network response can run.
  // The old cart's tax must never be exposed for newly selected inputs.
  return calculation?.cartTotal === cartTotal &&
    calculation.deliveryCost === deliveryCost &&
    calculation.taxRate === taxRate
    ? calculation.totals
    : null;
}
