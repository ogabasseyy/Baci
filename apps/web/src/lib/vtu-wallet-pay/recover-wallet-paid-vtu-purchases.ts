import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createWalletPayPorts } from '@/lib/piggyvest/wallet-pay-ports';
import { readWalletPayRecoveryRuntime } from '@/lib/piggyvest/wallet-pay-runtime';
import {
  refundWalletPayment,
  walletPayDelivery,
} from '@/lib/piggyvest/wallet-pay-service';
import { fulfillPendingVtuTransaction } from '@/lib/vtu-fulfillment';
import { isPiggyvestWalletPaid } from '@/lib/vtu-piggyvest-wallet-paid';
import { deliverVtuWalletPayment } from './deliver-vtu-wallet-payment';

export interface RecoverWalletPaidVtuSummary {
  /** Confirmed VTU payments whose vend was left interrupted or in flight. */
  checked: number;
  recovered: number;
  errored: number;
}

const defaultDeps = {
  readRuntime: () => readWalletPayRecoveryRuntime(),
  worker: (runtime: ReturnType<typeof readWalletPayRecoveryRuntime>) =>
    createWalletPayPorts(runtime).worker,
  delivery: (runtime: ReturnType<typeof readWalletPayRecoveryRuntime>) =>
    walletPayDelivery(runtime),
  refund: refundWalletPayment,
  fulfil: fulfillPendingVtuTransaction,
};

/**
 * A PiggyVest-paid purchase whose vend was interrupted or hit a transient
 * provider error stays pending (marked) after the customer leaves. Only the
 * holder of the payment's delivery claim may re-drive it (the vend runs
 * under the same provider reference, so it never doubles), and the
 * background drain never vends. So this step, run by the existing VTU
 * reconciliation cron with its own client, takes that claim for each such
 * confirmed payment nobody collected and finishes the vend, or records its
 * failure (which opens the one refund). A payment whose purchase is not
 * mid-vend (never vended, failed, delivered) is left to the drain, exactly
 * as before. Never throws: a failure is counted (Codex P1).
 */
export async function recoverWalletPaidVtuPurchases(
  input: { supabase: SupabaseClient; maxRows?: number },
  deps: typeof defaultDeps = defaultDeps
): Promise<RecoverWalletPaidVtuSummary> {
  const summary: RecoverWalletPaidVtuSummary = {
    checked: 0,
    recovered: 0,
    errored: 0,
  };
  let runtime: ReturnType<typeof readWalletPayRecoveryRuntime> | null;
  try {
    runtime = deps.readRuntime();
  } catch {
    // Wallet pay is not configured here: nothing to recover.
    return summary;
  }
  if (!runtime) return summary;
  try {
    const worker = deps.worker(runtime);
    const delivery = deps.delivery(runtime);
    const work = await worker.listWork(input.maxRows ?? 50);
    for (const item of work.deliver) {
      if (item.purpose !== 'vtu') continue;
      try {
        // Only a purchase mid-vend, and asked before the claim is taken, so
        // anything else is left to the drain without holding its claim.
        if (
          (await delivery.vtuDeliveryState(item.operationId)) !== 'processing'
        )
          continue;
        summary.checked += 1;
        const claim = await worker.claim(item.operationId);
        if (claim.status !== 'claimed' && claim.status !== 'reclaimed')
          continue;
        const transactionId = claim.purchaseRef;
        // The purchase must be a PiggyVest-paid row at exactly the paid
        // amount; anything else vends nothing (the drain settles it).
        const { data, error } = await input.supabase
          .from('vtu_transactions')
          .select('id, amount, metadata')
          .eq('id', transactionId)
          .maybeSingle();
        if (error) throw new Error('VTU purchase read failed');
        const row = data as {
          amount: number | string;
          metadata: Record<string, unknown> | null;
        } | null;
        if (
          !row ||
          claim.purpose !== 'vtu' ||
          !isPiggyvestWalletPaid(row.metadata) ||
          Math.round(Number(row.amount) * 100) !== claim.amountKobo
        )
          continue;
        await deliverVtuWalletPayment(
          {
            transactionId,
            operationId: item.operationId,
            amountKobo: claim.amountKobo,
          },
          {
            // The claim was just taken above: reuse that answer.
            claim: async () => claim,
            finish: delivery.finish,
            deliveryState: delivery.vtuDeliveryState,
            refund: (paymentId) =>
              deps.refund({ runtime: runtime as never, paymentId }),
            fulfil: (walletPayClaimed) =>
              deps.fulfil({
                supabase: input.supabase,
                transactionId,
                walletPayClaimed,
              }),
          }
        );
        summary.recovered += 1;
      } catch {
        summary.errored += 1;
      }
    }
  } catch {
    summary.errored += 1;
  }
  return summary;
}
