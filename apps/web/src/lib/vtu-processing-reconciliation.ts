import type { SupabaseClient } from '@supabase/supabase-js';
import { fulfillPendingVtuTransaction } from '@/lib/vtu-fulfillment';
import {
  getReconciliableStatusFilter,
  RECONCILABLE_VTU_TYPES,
} from '@/lib/vtu-reconciliation-filter';
import { overlayReplayAttributes } from '@/lib/vtu-replay-attribute-overlay';

const DEFAULT_RECONCILIATION_LIMIT = 25;
const MAX_RECONCILIATION_LIMIT = 50;
const MIN_PROCESSING_AGE_MS = 45_000;
const RECONCILIATION_PAGE_WINDOW_MS = 5 * 60 * 1000;
// Worst-case single-row cost: overlay refresh verify (~30s Monnify
// financial) + fulfill requery (2 x 15s Kuda status) + vend (up to
// 30s) + settlement overhead. Rows stop starting while less than
// this remains before the deadline, so a slow batch defers leftovers
// to the next cron tick instead of dying mid-row at maxDuration and
// stranding charged rows across page rotations (Codex R43 rnTRm).
const RECONCILIATION_SINGLE_ROW_WORST_CASE_MS = 120_000;

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

function getReconciliationWindowNumber(now: Date) {
  return Math.floor(now.getTime() / RECONCILIATION_PAGE_WINDOW_MS);
}

function getReconciliationPageCount({
  pageSize,
  totalCandidates,
}: {
  pageSize: number;
  totalCandidates: null | number;
}) {
  if (totalCandidates === null || totalCandidates <= pageSize) {
    return 1;
  }

  return Math.ceil(totalCandidates / pageSize);
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
  const pageCount = getReconciliationPageCount({
    pageSize,
    totalCandidates,
  });
  if (pageCount === 1) {
    return 0;
  }

  const pageIndex = getReconciliationWindowNumber(now) % pageCount;
  return pageIndex * pageSize;
}

/**
 * Drives one page of reconciliation candidates. `deadlineMs` is the
 * invoker's hard stop (epoch ms — the cron passes invocation start +
 * maxDuration): rows stop starting while less than a worst-case
 * single row remains, and leftovers ride the next page rotation.
 * Required: unbounded sequential batches can overrun maxDuration
 * and strand charged rows mid-backlog (Codex R43 rnTRm).
 */
export async function reconcileProcessingVtuTransactions({
  deadlineMs,
  limit,
  now = new Date(),
  supabase,
}: {
  deadlineMs: number;
  limit?: number;
  now?: Date;
  supabase: SupabaseClient;
}): Promise<VtuProcessingReconciliationSummary> {
  const olderThan = new Date(now.getTime() - MIN_PROCESSING_AGE_MS);
  const pageSize = normalizeLimit(limit);
  const { count, error: countError } = await supabase
    .from('vtu_transactions')
    .select('id', { count: 'exact', head: true })
    .or(getReconciliableStatusFilter(now))
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
    .or(getReconciliableStatusFilter(now))
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

  const fetched = (data ?? []) as ProcessingVtuCandidate[];
  // Rotate the intra-page start by this page's VISIT number, not the
  // window number: a page is revisited only every pageCount windows,
  // so a window-derived start would advance by pageCount per visit
  // and strand most positions forever. Windows visiting the same page
  // are w = visit * pageCount + page, hence visit = floor(w / P):
  // consecutive visits advance the start by exactly one, so every row
  // eventually leads a pass. Stateless by design — no cursor table,
  // and no per-attempt writes (any update bumps updated_at,
  // invalidating in-flight CAS tokens).
  const pageCount = getReconciliationPageCount({
    pageSize,
    totalCandidates: count,
  });
  const visitNumber = Math.floor(
    getReconciliationWindowNumber(now) / pageCount
  );
  const startIndex = fetched.length === 0 ? 0 : visitNumber % fetched.length;
  const candidates = [
    ...fetched.slice(startIndex),
    ...fetched.slice(0, startIndex),
  ];
  const summary: VtuProcessingReconciliationSummary = {
    checked: 0,
    errored: 0,
    errors: [],
    failed: 0,
    processing: 0,
    successful: 0,
  };

  for (const candidate of candidates) {
    if (Date.now() >= deadlineMs - RECONCILIATION_SINGLE_ROW_WORST_CASE_MS) {
      console.warn(
        'VTU reconciliation stopping early: route deadline approaching:',
        {
          checked: summary.checked,
          deferred: candidates.length - summary.checked,
        }
      );
      break;
    }
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
    } finally {
      summary.checked += 1;
    }
  }

  return summary;
}
