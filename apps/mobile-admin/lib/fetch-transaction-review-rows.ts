import { supabase } from '@/lib/supabase';
import { TRANSACTION_REVIEW_EXCLUDED_SHIPPING_STATUSES } from './transaction-review-status';

export function fetchTransactionReviewRows({
  endDateFilter,
  endDateIso,
  includeCancelledAt,
  includeTransactionDate,
  merchantId,
  selectStatement,
  startDateFilter,
  startDateIso,
}: {
  endDateFilter?: string;
  endDateIso?: string;
  includeCancelledAt: boolean;
  includeTransactionDate: boolean;
  merchantId: string;
  selectStatement: string;
  startDateFilter?: string;
  startDateIso?: string;
}) {
  let query = supabase
    .from('orders')
    .select(selectStatement)
    .eq('merchant_id', merchantId)
    .eq('payment_status', 'paid');

  if (includeCancelledAt) {
    query = query.is('cancelled_at', null);
  }

  query = query.or(
    `shipping_status.is.null,shipping_status.not.in.(${TRANSACTION_REVIEW_EXCLUDED_SHIPPING_STATUSES.join(',')})`
  );

  if (includeTransactionDate) {
    query = query.order('transaction_date', {
      ascending: false,
      nullsFirst: false,
    });
  }

  query = query.order('created_at', { ascending: false });

  if (includeTransactionDate && startDateFilter) {
    query = query.or(startDateFilter);
  } else if (!includeTransactionDate && startDateIso) {
    query = query.gte('created_at', startDateIso);
  }

  if (includeTransactionDate && endDateFilter) {
    query = query.or(endDateFilter);
  } else if (!includeTransactionDate && endDateIso) {
    query = query.lte('created_at', endDateIso);
  }

  return query.limit(40);
}
