import { isTransactionReviewSchemaCacheError } from './is-transaction-review-schema-cache-error';
import type { TransactionReviewQueryError } from './transaction-review-fallback-types';

function getTransactionReviewErrorText(error: TransactionReviewQueryError) {
  return [error?.code, error?.message, error?.details, error?.hint]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export function isMissingSchemaColumn(
  error: TransactionReviewQueryError,
  column: string
) {
  // Quote-aware: PostgREST quotes the missing name ("Could not find
  // the 'x' column ..."), so a bare substring probe for 'offer_id'
  // must not match a 'product_offer_id' (or 'offer_id_snapshot')
  // drift report and strip a column that actually exists.
  return (
    getTransactionReviewErrorText(error).includes(
      `'${column.toLowerCase()}'`
    ) && isTransactionReviewSchemaCacheError(error)
  );
}
