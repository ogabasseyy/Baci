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

export async function runBaseTransactionReviewQuery(
  stage: TransactionReviewFallbackStage,
  query: TransactionReviewFallbackQuery,
  selectStatement: string,
  includeCancelledAt: boolean,
  taxAmountFallback?: TaxAmountFallback
) {
  const options: TransactionReviewQueryOptions = {
    endDateIso: query.endDateIso,
    includeCancelledAt,
    includeTransactionDate: false,
    merchantId: query.merchantId,
    selectStatement,
    startDateIso: query.startDateIso,
  };
  return taxAmountFallback
    ? runTransactionReviewQueryWithTaxFallback(
        stage,
        options,
        taxAmountFallback
      )
    : await fetchTransactionReviewRows(options);
}
