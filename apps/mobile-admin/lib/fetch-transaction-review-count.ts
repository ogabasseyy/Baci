import { supabase } from '@/lib/supabase';
import { buildTransactionReviewOrFilter } from './build-transaction-review-or-filter';
import { isMissingSchemaColumn } from './is-missing-transaction-review-schema-column';
import { buildTransactionReviewRangeFilters } from './transaction-review';
import type { TransactionReviewQueryError } from './transaction-review-fallback-types';

interface TransactionReviewCountQuery {
  endDateIso?: string;
  includeCancelledAt: boolean;
  includeTransactionDate: boolean;
  merchantId: string;
  startDateIso?: string;
}

async function runTransactionReviewCountQuery({
  endDateIso,
  includeCancelledAt,
  includeTransactionDate,
  merchantId,
  startDateIso,
}: TransactionReviewCountQuery) {
  const { endDateFilter, startDateFilter } = buildTransactionReviewRangeFilters(
    startDateIso,
    endDateIso
  );
  let query = supabase
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('merchant_id', merchantId)
    .eq('payment_status', 'paid');

  if (includeCancelledAt) query = query.is('cancelled_at', null);
  if (!includeTransactionDate) {
    if (startDateIso) query = query.gte('created_at', startDateIso);
    if (endDateIso) query = query.lte('created_at', endDateIso);
  }
  query = query.or(
    buildTransactionReviewOrFilter({
      endDateFilter,
      includeTransactionDate,
      startDateFilter,
    })
  );

  const { count, error } = await query;

  return {
    count: error ? null : (count ?? 0),
    error: error as TransactionReviewQueryError,
  };
}

/** Returns the exact filtered order count without transferring rows. */
export async function fetchTransactionReviewCount({
  endDateIso,
  merchantId,
  startDateIso,
}: {
  endDateIso?: string;
  merchantId: string;
  startDateIso?: string;
}) {
  let includeCancelledAt = true;
  let includeTransactionDate = true;
  let result = await runTransactionReviewCountQuery({
    endDateIso,
    includeCancelledAt,
    includeTransactionDate,
    merchantId,
    startDateIso,
  });

  while (result.error) {
    if (
      includeTransactionDate &&
      isMissingSchemaColumn(result.error, 'transaction_date')
    ) {
      includeTransactionDate = false;
    } else if (
      includeCancelledAt &&
      isMissingSchemaColumn(result.error, 'cancelled_at')
    ) {
      includeCancelledAt = false;
    } else {
      break;
    }
    result = await runTransactionReviewCountQuery({
      endDateIso,
      includeCancelledAt,
      includeTransactionDate,
      merchantId,
      startDateIso,
    });
  }

  return result;
}
