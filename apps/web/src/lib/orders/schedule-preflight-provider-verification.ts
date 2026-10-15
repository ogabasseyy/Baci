import type { SupabaseClient } from '@supabase/supabase-js';
import { checkCancellationRefundProvider } from '@/lib/orders/check-cancellation-refund-provider';
import type { GatewayPaymentTransaction } from '@/lib/orders/gateway-payment-transaction';
import type { CancellationOrder } from '@/lib/orders/order-cancellation-side-effect-types';
import { tryResetCancellationSideEffectAttempts } from '@/lib/orders/reset-cancellation-side-effect-attempts';
import { DeferredError } from '@/lib/orders/run-order-cancellation-side-effect';
import type { CancellationRefundLedgerRow } from './preflight-cancellation-refund-initiation';

// Worst-case sizing for one leg's provider preflight: a verify plus a
// list page may take up to 30s (mirroring the provider precedent),
// and the finish write reserves 8s after the last response
// (mirroring the audit margin precedent).
const PREFLIGHT_PROVIDER_CALL_WORST_MS = 30_000;
const PREFLIGHT_FINISH_WRITE_RESERVE_MS = 8_000;
// Worst-case budget a refund verification needs before it may start:
// the provider check plus the finish-write reserve. Initiation
// self-gates per leg (it defers when its own call plus audit
// reserve will not fit), so demanding an initiation leg here too
// would idle every window between 38s and 76s even though a
// verification plus a fast initiation fits them in practice —
// under a 90s drain with reconciliation backlog, the first
// verification would never start. Worst-case windows still verify
// one leg, stamp manual proof, and defer the rest, so progress
// persists instead of starving. Single source: the admission below
// and the runner's post-claim execution gate (see
// run-order-cancellation-side-effect) share it, so they cannot
// drift apart. (The drain deliberately does NOT pre-skip refunds:
// the claim itself finalizes cheap rows without a worker run.)
export const REFUND_PREFLIGHT_ADMISSION_BUDGET_MS =
  PREFLIGHT_PROVIDER_CALL_WORST_MS + PREFLIGHT_FINISH_WRITE_RESERVE_MS;

// Run one leg's provider verification under the admission budget.
// Returns true when the leg verified, false when the window ran
// short (the caller initiates its verified prefix and resumes the
// rest). Only a window too short for any verification throws —
// after a verified prefix exists, both a short window and a
// deferred provider check become a shortfall, so every drain makes
// persistent progress instead of repeating the same checks.
export async function schedulePreflightProviderVerification({
  deadlineMs,
  hasVerifiedPrefix,
  linkedPaymentId,
  order,
  refundRows,
  supabase,
  transaction,
}: {
  deadlineMs?: number;
  hasVerifiedPrefix: boolean;
  linkedPaymentId: (row: { metadata: unknown }) => string | null;
  order: CancellationOrder;
  refundRows: CancellationRefundLedgerRow[];
  supabase: Pick<SupabaseClient, 'from' | 'rpc'>;
  transaction: GatewayPaymentTransaction & { gateway_reference: string };
}): Promise<boolean> {
  // Reserve this verification plus one initiation leg before
  // starting another provider check: initiation paces itself per
  // leg, so one leg of room guarantees this run converts its
  // verified prefix into initiated refunds. Reserving the whole
  // outstanding set instead starves multi-leg orders behind every
  // window shorter than the full worst case.
  if (
    deadlineMs !== undefined &&
    deadlineMs - Date.now() < REFUND_PREFLIGHT_ADMISSION_BUDGET_MS
  ) {
    if (hasVerifiedPrefix) {
      return false;
    }
    // Starvation is not failure: reset the budget the claim
    // consumed so the resume retries fresh instead of mistaking
    // a short window for exhaustion.
    await tryResetCancellationSideEffectAttempts(supabase, order.id, 'refund');
    throw new DeferredError(
      'cancellation_refund_preflight_deferred_for_budget'
    );
  }
  // Bound the listing by the preflight worst case, not the raw drain
  // deadline: a deep history (verify plus several pages) must not
  // consume the window initiation needs.
  const listingDeadlineMs =
    deadlineMs === undefined
      ? undefined
      : Math.min(deadlineMs, Date.now() + PREFLIGHT_PROVIDER_CALL_WORST_MS);
  try {
    await checkCancellationRefundProvider({
      currency: transaction.currency || order.currency || 'NGN',
      deadlineMs: listingDeadlineMs,
      knownRefunds: refundRows.filter(
        (row) => linkedPaymentId(row) === transaction.id
      ),
      order,
      reference: transaction.gateway_reference,
      supabase,
      transaction,
    });
  } catch (error) {
    if (error instanceof DeferredError && hasVerifiedPrefix) {
      // A later check's deferral must not discard the verified
      // prefix: treat it like a budget shortfall so settle
      // initiates verified legs and resumes the rest. Settle resets
      // the budget on the deferred resume; the prefix initiation is
      // the persistent progress.
      return false;
    }
    if (error instanceof DeferredError) {
      await tryResetCancellationSideEffectAttempts(
        supabase,
        order.id,
        'refund'
      );
    }
    throw error;
  }
  return true;
}
