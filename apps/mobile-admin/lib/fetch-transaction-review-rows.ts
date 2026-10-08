import { supabase } from '@/lib/supabase';
import { TRANSACTION_REVIEW_EXCLUDED_SHIPPING_STATUSES } from './transaction-review-status';
import type { TransactionReviewOrderRow } from './transaction-review-types';

const PAGE_SIZE = 200;

export async function fetchTransactionReviewRows({
  fetchAll = false,
  endDateFilter,
  endDateIso,
  includeCancelledAt,
  includeTransactionDate,
  merchantId,
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
  selectStatement: string;
  startDateFilter?: string;
  startDateIso?: string;
}) {
  function createQuery(cursor?: string) {
    let query = supabase
      .from('orders')
      .select(selectStatement)
      .eq('merchant_id', merchantId)
      .eq('payment_status', 'paid');

    if (includeCancelledAt) query = query.is('cancelled_at', null);
    const visibilityFilter = `shipping_status.is.null,shipping_status.not.in.(${TRANSACTION_REVIEW_EXCLUDED_SHIPPING_STATUSES.join(',')})`;
    const orFilters = [visibilityFilter];
    if (includeTransactionDate) {
      if (startDateFilter) orFilters.push(startDateFilter);
      if (endDateFilter) orFilters.push(endDateFilter);
    } else {
      if (startDateIso) query = query.gte('created_at', startDateIso);
      if (endDateIso) query = query.lte('created_at', endDateIso);
    }
    // Repeated .or() calls overwrite each other in PostgREST's URL parameters.
    query = query.or(
      orFilters.length === 1
        ? visibilityFilter
        : `and(${orFilters.map((filter) => `or(${filter})`).join(',')})`
    );

    if (fetchAll) {
      // A stable unique cursor avoids shifting offsets when new orders arrive.
      query = query.order('id', { ascending: true });
      if (cursor) query = query.gt('id', cursor);
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
      .limit(fetchAll ? PAGE_SIZE : 40)
      .returns<TransactionReviewOrderRow[]>();
  }

  if (!fetchAll) return createQuery();

  const rows: TransactionReviewOrderRow[] = [];
  let cursor: string | undefined;
  while (true) {
    const result = await createQuery(cursor);
    if (result.error) return { data: null, error: result.error };
    const page = result.data ?? [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) {
      rows.sort((a, b) => {
        const dateDifference =
          new Date(b.transaction_date ?? b.created_at).getTime() -
          new Date(a.transaction_date ?? a.created_at).getTime();
        return dateDifference || b.id.localeCompare(a.id);
      });
      return { data: rows, error: null };
    }
    cursor = page[page.length - 1].id;
  }
}
