import { fetchTransactionReviewRows } from './fetch-transaction-review-rows';
import { runTransactionReviewQueryWithTaxFallback } from './run-transaction-review-query-with-tax-fallback';
import type {
  TaxAmountFallback,
  TransactionReviewFallbackQuery,
  TransactionReviewFallbackStage,
} from './transaction-review-fallback-types';

type TransactionReviewQueryOptions = Parameters<
  typeof fetchTransactionReviewRows
>[0];

export async function runLegacyTransactionReviewQuery(
  stage: TransactionReviewFallbackStage,
  query: TransactionReviewFallbackQuery,
  selectStatement: string,
  includeCancelledAt: boolean,
  taxAmountFallback?: TaxAmountFallback,
  includeTransactionDate = true
) {
  const options: TransactionReviewQueryOptions = {
    ...query,
    includeCancelledAt,
    includeTransactionDate,
    selectStatement,
  };
  return taxAmountFallback
    ? runTransactionReviewQueryWithTaxFallback(
        stage,
        options,
        taxAmountFallback
      )
    : await fetchTransactionReviewRows(options);
}
