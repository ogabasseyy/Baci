import type { GatewayPaymentTransaction } from './gateway-payment-transaction';

/**
 * Mirror the claim gate's sole-completed-leg attribution: an unlinked
 * legacy refund covering the only completed leg must not terminalize
 * the step while another leg's provider refund is still outstanding —
 * the completion gate attributes it and finalizes once that leg lands.
 */
export function soleCompletedCancellationLeg(
  transactions: GatewayPaymentTransaction[]
): GatewayPaymentTransaction | null {
  const legs = transactions.filter(
    (transaction) =>
      transaction.status === 'completed' && Number(transaction.amount) > 0
  );
  return legs.length === 1 ? legs[0] : null;
}
