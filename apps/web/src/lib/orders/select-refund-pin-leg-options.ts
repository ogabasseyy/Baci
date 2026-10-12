import { orderRefundMethodLabels } from '@/config/order-refund';
import { formatDisplayCurrency } from '@/lib/format-display-currency';
import type { RefundSummary } from './refund-summary';

// Pin-candidate options for the manual form: one row per eligible
// leg with the capture reference merchants recognize from the
// Paystack dashboard, plus the still-outstanding amount so a
// partial capture is not mistaken for a full one.
export function selectRefundPinLegOptions(
  legs: RefundSummary['legs'],
  currency: string
): Array<{ id: string; label: string }> {
  return legs.map((leg) => ({
    id: leg.id,
    label: `${orderRefundMethodLabels[leg.gateway ?? ''] ?? leg.gateway ?? 'Unknown'} · ${leg.reference ?? leg.id.slice(0, 8)} · ${formatDisplayCurrency(leg.outstanding, currency, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} outstanding`,
  }));
}
