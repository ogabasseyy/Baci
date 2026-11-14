import 'server-only';
import {
  isPiggyvestWalletPaid,
  piggyvestWalletPaidHold,
} from '@/lib/vtu-piggyvest-wallet-paid';

type GateRow = {
  amount: unknown;
  request_reference: string;
  status: string;
  error_message?: string | null;
  metadata?: Record<string, unknown> | null;
};

/**
 * Whether fulfillPendingVtuTransaction may go on with a row, and what a
 * PiggyVest-paid row answers when it may not. Such a row moves no store
 * credit and is vended (or failed and refunded) only by the request holding
 * its payment's delivery claim; every other caller (cron, history, replays)
 * waits, before any refund bookkeeping (Muse). A processing row
 * (provider-status reconciliation, never a new vend) and a pending row
 * marked by an interrupted or transient vend (idempotent re-drive of a
 * payment already confirmed) go on: both were reached only under the claim
 * and debit no store credit (Codex P1).
 *
 * Returns the hold answer, or null to carry on. `retryFailed` is never
 * honoured for a PiggyVest-paid row: its refund goes to PiggyVest, never a
 * re-vend.
 */
export function piggyvestFulfilmentGate(
  row: GateRow,
  options: { walletPayClaimed: boolean; retryFailedRequested: boolean }
) {
  const piggyvestPaid = isPiggyvestWalletPaid(row.metadata);
  const retryFailed = options.retryFailedRequested && !piggyvestPaid;
  // Only a processing row (provider-status reconciliation, never a new
  // vend) goes on without the claim. A pending row marked by an interrupted
  // or transient vend can be re-driven into a vend, so only the claim holder
  // re-drives it (the drain's reclaim after a lapse); the reconciliation cron
  // and plain replays wait (Muse high).
  const recovery = row.status === 'processing';
  const hold =
    piggyvestPaid &&
    !options.walletPayClaimed &&
    !recovery &&
    row.status !== 'successful'
      ? piggyvestWalletPaidHold(row)
      : null;
  return { retryFailed, hold };
}
