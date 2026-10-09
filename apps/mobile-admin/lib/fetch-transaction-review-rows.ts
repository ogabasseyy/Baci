import { supabase } from '@/lib/supabase';
import { buildTransactionReviewOrFilter } from './build-transaction-review-or-filter';
import type { TransactionReviewOrderRow } from './transaction-review-types';

const PAGE_SIZE = 200;

// Bounds the legacy client-side scan so an unmigrated database with a huge
// history cannot transfer an unbounded result set. Histories under the cap
// still scan completely; larger ones report truncated so the UI can say so.
const MAX_FETCH_ALL_ROWS = 2000;

export async function fetchTransactionReviewRows({
  fetchAll = false,
  endDateFilter,
  endDateIso,
  includeCancelledAt,
  includeTransactionDate,
  merchantId,
  orderIds,
  selectStatement,
  startDateFilter,
  startDateIso,
}: {
  fetchAll?: boolean;
  endDateFilter?: string;
  endDateIso?: string;
  includeCancelledAt: boolean;
  includeTransactionDate: boolean;
  merchantId: string;
  orderIds?: string[];
  selectStatement: string;
  startDateFilter?: string;
  startDateIso?: string;
}) {
  function createQuery(
    cursor?: { createdAt: string; id: string; transactionDate?: string },
    phase?: 'dated' | 'undated'
  ) {
    let query = supabase
      .from('orders')
      .select(selectStatement)
      .eq('merchant_id', merchantId)
      .eq('payment_status', 'paid');

    if (includeCancelledAt) query = query.is('cancelled_at', null);
    if (orderIds) query = query.in('id', orderIds);
    if (!includeTransactionDate) {
      if (startDateIso) query = query.gte('created_at', startDateIso);
      if (endDateIso) query = query.lte('created_at', endDateIso);
    }
    query = query.or(
      buildTransactionReviewOrFilter({
        endDateFilter,
        includeTransactionDate,
        startDateFilter,
        ...(phase ? { phase } : {}),
        ...(fetchAll && cursor ? { cursor } : {}),
      })
    );

    if (fetchAll) {
      // Newest-first keyset over the effective date (transaction_date,
      // created_at, id): paging by created_at alone would cap an arbitrary
      // subset for re-dated orders, and id order is random (v4 UUIDs), so a
      // recent match could never appear. Undated rows scan in their own
      // phase (nulls last, matching browse order) because a keyset cannot
      // page across the null boundary. The tiebreaks keep paging exact.
      if (phase === 'dated') {
        query = query
          .order('transaction_date', { ascending: false, nullsFirst: false })
          .order('created_at', { ascending: false })
          .order('id', { ascending: false });
      } else {
        query = query
          .order('created_at', { ascending: false })
          .order('id', { ascending: false });
      }
    } else {
      if (includeTransactionDate) {
        query = query.order('transaction_date', {
          ascending: false,
          nullsFirst: false,
        });
      }
      query = query
        .order('created_at', { ascending: false })
        .order('id', { ascending: false });
    }
    return query
      .limit(fetchAll ? PAGE_SIZE : orderIds ? orderIds.length : 40)
      .returns<TransactionReviewOrderRow[]>();
  }

  if (!fetchAll) {
    // Awaited here so every return shares one { data, error, truncated }
    // shape; the windowed browse path never truncates.
    const result = await createQuery();
    return { data: result.data, error: result.error, truncated: false };
  }

  const rows: TransactionReviewOrderRow[] = [];
  let truncated = false;
  // Dated rows first (newest effective date), then undated legacy rows: a
  // re-dated order ranks by its transaction date, not its creation time.
  const phases =
    includeTransactionDate && fetchAll
      ? (['dated', 'undated'] as const)
      : ([undefined] as const);
  for (const phase of phases) {
    let cursor:
      | { createdAt: string; id: string; transactionDate?: string }
      | undefined;
    while (true) {
      const result = await createQuery(cursor, phase);
      if (result.error) return { data: null, error: result.error, truncated };
      const page = result.data ?? [];
      rows.push(...page);
      if (page.length < PAGE_SIZE) {
        // Short page: this phase ended here, so move to the next phase (or
        // finish when no phase remains).
        break;
      }
      if (rows.length >= MAX_FETCH_ALL_ROWS) {
        // Full pages so far and the cap is reached: more rows may exist, so
        // stop fetching and report the scan as truncated. (A history of
        // exactly MAX_FETCH_ALL_ROWS also reports truncated, since confirming
        // completeness would cost another page fetch; the notice errs toward
        // disclosure.)
        truncated = true;
        break;
      }
      const lastRow = page[page.length - 1];
      // The dated phase only returns dated rows; without a transaction date
      // the cursor degrades to (created_at, id).
      cursor = {
        createdAt: lastRow.created_at,
        id: lastRow.id,
        ...(lastRow.transaction_date
          ? { transactionDate: lastRow.transaction_date }
          : {}),
      };
    }
    if (truncated) break;
  }
  rows.sort((a, b) => {
    const dateDifference =
      new Date(b.transaction_date ?? b.created_at).getTime() -
      new Date(a.transaction_date ?? a.created_at).getTime();
    // Match browsing order (created_at, then id) for same-date rows.
    const createdAtDifference =
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    return dateDifference || createdAtDifference || b.id.localeCompare(a.id);
  });
  return { data: rows, error: null, truncated };
}
