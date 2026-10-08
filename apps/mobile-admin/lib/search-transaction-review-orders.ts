import { supabase } from '@/lib/supabase';
import { splitTransactionSearchTerms } from './transaction-review';
import type { TransactionReviewQueryError } from './transaction-review-fallback-types';

export const TRANSACTION_REVIEW_SEARCH_LIMIT = 100;

export type TransactionReviewSearchErrorKind =
  | 'missing-search-function'
  | 'search-failed';

export interface TransactionReviewSearchResult {
  error: TransactionReviewQueryError;
  errorKind: TransactionReviewSearchErrorKind | null;
  orderIds: string[];
}

function isMissingSearchFunction(error: TransactionReviewQueryError) {
  const errorText = [error?.code, error?.message]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return (
    errorText.includes('could not find the function') ||
    error?.code === 'PGRST202'
  );
}

/** Returns bounded transaction-review order ids matching every search term. */
export async function searchTransactionReviewOrders({
  limit = TRANSACTION_REVIEW_SEARCH_LIMIT + 1,
  merchantId,
  offset = 0,
  search,
}: {
  limit?: number;
  merchantId: string;
  offset?: number;
  search: string;
}): Promise<TransactionReviewSearchResult> {
  const terms = splitTransactionSearchTerms(search);

  if (terms.length === 0) {
    return { error: null, errorKind: null, orderIds: [] };
  }

  // Fetch one extra id so callers can tell a complete result from a
  // truncated one without a second count query.
  const { data, error } = await supabase.rpc(
    'search_mobile_admin_transaction_review_orders',
    {
      p_limit: limit,
      p_merchant_id: merchantId,
      p_offset: offset,
      p_terms: terms,
    }
  );

  if (error) {
    return {
      error,
      errorKind: isMissingSearchFunction(error)
        ? 'missing-search-function'
        : 'search-failed',
      orderIds: [],
    };
  }

  const rows = (Array.isArray(data) ? data : []) as Array<{
    order_id?: unknown;
  }>;
  const orderIds = rows
    .map((row) => row?.order_id)
    .filter((orderId): orderId is string => typeof orderId === 'string');

  return { error: null, errorKind: null, orderIds };
}
