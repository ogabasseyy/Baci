import { VTU_TYPE_LABELS } from '@/lib/vtu-pending-transaction';

/**
 * Wallet/card split persisted at prepare time for hybrid checkout
 * rows. Moved here from vtu-fulfillment (Codex R106 P1) with its
 * readers, per the 300-line ceiling.
 */
export interface PaymentSplit {
  wallet: number;
  card: number;
}

export function readPaymentSplit(
  metadata: Record<string, unknown> | null | undefined
): PaymentSplit | null {
  const split = metadata?.paymentSplit as Partial<PaymentSplit> | undefined;
  if (
    !split ||
    typeof split.wallet !== 'number' ||
    typeof split.card !== 'number'
  ) {
    return null;
  }
  return { wallet: split.wallet, card: split.card };
}

/**
 * Human label for the row's provider, used in refund descriptions.
 * Structural row param (Codex R106 P1): the full VtuTransactionRow
 * lives in the fulfillment orchestrator, which imports this
 * module — typing the whole row would cycle the imports.
 */
export function getVtuProviderLabel(row: {
  biller_name: string | null;
  network_provider: string | null;
  type: keyof typeof VTU_TYPE_LABELS;
}) {
  return row.network_provider || row.biller_name || VTU_TYPE_LABELS[row.type];
}
