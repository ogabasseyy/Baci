import { fetchTransactionReviewRows } from './fetch-transaction-review-rows';
import { isMissingSchemaColumn } from './is-missing-transaction-review-schema-column';
import type {
  TaxAmountFallback,
  TransactionReviewFallbackStage,
  TransactionReviewQueryOptions,
} from './transaction-review-fallback-types';

function warnTransactionReviewQueryError(
  stage: TransactionReviewFallbackStage,
  error: Awaited<ReturnType<typeof fetchTransactionReviewRows>>['error']
) {
  if (__DEV__ && error) {
    console.warn('[TransactionReview] select failed', { error, stage });
  }
}

async function runTransactionReviewQuery(
  stage: TransactionReviewFallbackStage,
  options: TransactionReviewQueryOptions
) {
  const result = await fetchTransactionReviewRows(options);
  warnTransactionReviewQueryError(stage, result.error);
  return result;
}

export async function runTransactionReviewQueryWithTaxFallback(
  stage: TransactionReviewFallbackStage,
  options: TransactionReviewQueryOptions,
  taxAmountFallback: TaxAmountFallback
) {
  let result = await runTransactionReviewQuery(stage, options);
  if (isMissingSchemaColumn(result.error, 'tax_amount')) {
    result = await runTransactionReviewQuery(taxAmountFallback.stage, {
      ...options,
      selectStatement: taxAmountFallback.selectStatement,
    });
  }
  return result;
}
