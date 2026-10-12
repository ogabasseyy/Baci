import type { SupabaseClient } from '@supabase/supabase-js';
import { fulfillPendingVtuTransaction } from '@/lib/vtu-fulfillment';
import { overlayReplayAttributes } from '@/lib/vtu-replay-attribute-overlay';

// Every type the wallet-only route can leave 'processing' (202): a
// customer who closes the pending screen without retrying must still
// have their transaction resolved (success or failed+refund) by the
// cron. Fulfill is the same generic resume the replay path uses, and
// the wallet RPC's source_id idempotency makes re-driving safe.
const RECONCILABLE_VTU_TYPES = [
  'airtime',
  'data',
  'electricity',
  'cable_tv',
  'betting',
] as const;
// Processing rows requery by provider reference; marked pending rows
// re-vend instead (claim → idempotent debit → vend): Monnify timeouts
// restored to pending (requery without a vendReference is PENDING
// forever) and pre-vend interruptions (debit RPC / walletDebited
// write failures — reference-less, so the reconcile claim declines
// them). Failed rows persist BEFORE their refund is attempted, so a
// transient reversal failure would strand the debit when the customer
// closes the client instead of retrying (the 500 keeps the key, but
// only a retry re-drives it): failed+refund-required+unissued rows
// are selected so the failed branch confirms the refund. The failed
// clause mirrors requiresVtuCustomerWalletRefund in PostgREST form —
// gating on the wallet-debit marker instead would permanently exclude
// card-only rows (no marker) whose refundCardOnly failed, leaving
// history refund_pending with no background path retrying the credit.
// Plain pending rows (mapping-less orphans, PK-race leftovers) and
// already-refunded failures stay excluded.
const RECONCILABLE_STATUS_FILTER =
  'status.eq.processing,and(status.eq.pending,or(metadata->>monnifyTransientVendError.not.is.null,metadata->>preVendInterruptedAt.not.is.null)),and(status.eq.failed,source.eq.checkout,amount.gt.0,customer_id.not.is.null,metadata->>refundIssued.is.null)';
const DEFAULT_RECONCILIATION_LIMIT = 25;
const MAX_RECONCILIATION_LIMIT = 50;
const MIN_PROCESSING_AGE_MS = 45_000;
const RECONCILIATION_PAGE_WINDOW_MS = 5 * 60 * 1000;

interface ProcessingVtuCandidate {
  id: string;
}

export interface VtuProcessingReconciliationSummary {
  checked: number;
  errored: number;
  errors: Array<{
    message: string;
    transactionId: string;
  }>;
  failed: number;
  processing: number;
  successful: number;
}

function normalizeLimit(limit: number | undefined) {
  if (!Number.isSafeInteger(limit) || !limit || limit < 1) {
    return DEFAULT_RECONCILIATION_LIMIT;
  }

  return Math.min(limit, MAX_RECONCILIATION_LIMIT);
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function getReconciliationPageOffset({
  now,
  pageSize,
  totalCandidates,
}: {
  now: Date;
  pageSize: number;
  totalCandidates: null | number;
}) {
  if (totalCandidates === null || totalCandidates <= pageSize) {
    return 0;
  }

  const pageCount = Math.ceil(totalCandidates / pageSize);
  const pageIndex =
    Math.floor(now.getTime() / RECONCILIATION_PAGE_WINDOW_MS) % pageCount;
  return pageIndex * pageSize;
}

export async function reconcileProcessingVtuTransactions({
  limit,
  now = new Date(),
  supabase,
}: {
  limit?: number;
  now?: Date;
  supabase: SupabaseClient;
}): Promise<VtuProcessingReconciliationSummary> {
  const olderThan = new Date(now.getTime() - MIN_PROCESSING_AGE_MS);
  const pageSize = normalizeLimit(limit);
  const { count, error: countError } = await supabase
    .from('vtu_transactions')
    .select('id', { count: 'exact', head: true })
    .or(RECONCILABLE_STATUS_FILTER)
    .in('type', [...RECONCILABLE_VTU_TYPES])
    .lte('created_at', olderThan.toISOString())
    .limit(1);

  if (countError) {
    throw new Error(
      `Failed to count processing VTU transactions: ${countError.message}`
    );
  }

  const pageOffset = getReconciliationPageOffset({
    now,
    pageSize,
    totalCandidates: count,
  });
  const { data, error } = await supabase
    .from('vtu_transactions')
    .select('id')
    .or(RECONCILABLE_STATUS_FILTER)
    .in('type', [...RECONCILABLE_VTU_TYPES])
    .lte('created_at', olderThan.toISOString())
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .range(pageOffset, pageOffset + pageSize - 1);

  if (error) {
    throw new Error(
      `Failed to fetch processing VTU transactions: ${error.message}`
    );
  }

  const candidates = (data ?? []) as ProcessingVtuCandidate[];
  const summary: VtuProcessingReconciliationSummary = {
    checked: candidates.length,
    errored: 0,
    errors: [],
    failed: 0,
    processing: 0,
    successful: 0,
  };

  for (const candidate of candidates) {
    try {
      // No client values on this path: refresh a server-minted
      // validation reference (airtime) so the re-drive below does
      // not reuse an expired attempt-1 value (Codex R33 gtRN).
      await overlayReplayAttributes({
        supabase,
        transactionId: candidate.id,
        customerPhone: undefined,
        validationReference: undefined,
      });
      const result = await fulfillPendingVtuTransaction({
        supabase,
        transactionId: candidate.id,
      });
      if (result.status === 'successful') {
        summary.successful += 1;
      } else if (result.status === 'failed') {
        summary.failed += 1;
      } else {
        summary.processing += 1;
      }
    } catch (error) {
      summary.errored += 1;
      summary.errors.push({
        message: getErrorMessage(error),
        transactionId: candidate.id,
      });
    }
  }

  return summary;
}
