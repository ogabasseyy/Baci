import { normalizeRefundMoneyField } from './normalize-refund-money-field';

// A manual row declared as Paystack is only a merchant claim about
// provider money: without provider confirmation it must quarantine
// for review like the claim gate. Shared by the coverage matcher and
// the executor's internal-only branch so both gates agree; no
// reconciler stamps manual rows today, so such rows always quarantine
// for now.
export function isUnverifiedManualPaystackRefund(row: {
  gateway: unknown;
  metadata: unknown;
}): boolean {
  if (normalizeRefundMoneyField(row.gateway) !== 'MANUAL') return false;
  const metadata = row.metadata as {
    method?: unknown;
    provider_refund_status?: unknown;
  } | null;
  return (
    metadata?.method === 'paystack' &&
    metadata?.provider_refund_status !== 'processed'
  );
}
