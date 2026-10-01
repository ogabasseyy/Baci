import type { fetchTransactionReviewRows } from './fetch-transaction-review-rows';

export interface TransactionReviewFallbackQuery {
  endDateFilter?: string;
  endDateIso?: string;
  merchantId: string;
  startDateFilter?: string;
  startDateIso?: string;
}

export type TransactionReviewQueryError = {
  code?: string;
  details?: string;
  hint?: string;
  message?: string;
} | null;

export type TransactionReviewFallbackStage = string;

export type TransactionReviewQueryOptions = Parameters<
  typeof fetchTransactionReviewRows
>[0];

export type TransactionReviewQueryResult = Awaited<
  ReturnType<typeof fetchTransactionReviewRows>
>;

export type TaxAmountFallback = Readonly<{
  selectStatement: string;
  stage: TransactionReviewFallbackStage;
}>;
