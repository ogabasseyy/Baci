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
  return (
    getTransactionReviewErrorText(error).includes(column) &&
    isTransactionReviewSchemaCacheError(error)
  );
}
