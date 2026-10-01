import { fetchRichTransactionReviewRows } from './fetch-transaction-review-rich-fallback';
import { isMissingSchemaColumn } from './is-missing-transaction-review-schema-column';
import { isTransactionReviewSchemaCacheError } from './is-transaction-review-schema-cache-error';
import { runBaseTransactionReviewQuery } from './run-base-transaction-review-query';
import { runLegacyTransactionReviewQuery } from './run-legacy-transaction-review-query';
import { createTransactionReviewSchemaColumnState } from './transaction-review-fallback-schema-columns';
import type {
  TaxAmountFallback,
  TransactionReviewFallbackQuery,
} from './transaction-review-fallback-types';
import { TRANSACTION_REVIEW_SELECTORS } from './transaction-review-selectors';
/** Reads transaction-review rows with schema-drift fallbacks. */
export async function fetchTransactionReviewWithFallbacks(
  query: TransactionReviewFallbackQuery
) {
  const schemaColumnState = createTransactionReviewSchemaColumnState();
  type TransactionReviewFallbackResult = Awaited<
    ReturnType<typeof runLegacyTransactionReviewQuery>
  >;
  const runWithUnavailableSchemaColumns = async (
    runQuery: () => Promise<TransactionReviewFallbackResult>
  ) => {
    let result = await runQuery();
    while (true) {
      let shouldRetry = false;
      if (
        [
          'quiz_award_id',
          'quiz_award_amount',
          'line_id',
          'discount_code_id',
          'discount_amount',
          'ad_tracking',
          'cancelled_at',
          'transaction_date',
          'variant_id',
          'variant_attributes',
        ].some(
          (column) =>
            isMissingSchemaColumn(result.error, column) &&
            schemaColumnState.markMissingSchemaColumn(column)
        )
      ) {
        shouldRetry = true;
      }
      if (!shouldRetry) {
        return result;
      }
      result = await runQuery();
    }
  };
  const runLegacyFallbackQuery = (
    stage: string,
    selectStatement: string,
    includeCancelledAt: boolean,
    taxAmountFallback?: TaxAmountFallback
  ) => {
    const runQuery = () =>
      runLegacyTransactionReviewQuery(
        stage,
        query,
        schemaColumnState.omitUnavailableSchemaColumns(selectStatement),
        includeCancelledAt &&
          !schemaColumnState.getSchemaColumnAvailability()
            .cancelledAtUnavailable,
        taxAmountFallback
          ? {
              ...taxAmountFallback,
              selectStatement: schemaColumnState.omitUnavailableSchemaColumns(
                taxAmountFallback.selectStatement
              ),
            }
          : undefined,
        !schemaColumnState.getSchemaColumnAvailability()
          .transactionDateUnavailable
      );
    return runWithUnavailableSchemaColumns(runQuery);
  };
  const runBaseFallbackQuery = (
    stage: string,
    selectStatement: string,
    includeCancelledAt: boolean,
    taxAmountFallback?: TaxAmountFallback
  ) => {
    const runQuery = () =>
      runBaseTransactionReviewQuery(
        stage,
        query,
        schemaColumnState.omitUnavailableSchemaColumns(selectStatement),
        includeCancelledAt &&
          !schemaColumnState.getSchemaColumnAvailability()
            .cancelledAtUnavailable,
        taxAmountFallback
          ? {
              ...taxAmountFallback,
              selectStatement: schemaColumnState.omitUnavailableSchemaColumns(
                taxAmountFallback.selectStatement
              ),
            }
          : undefined
      );
    return runWithUnavailableSchemaColumns(runQuery);
  };
  let { data, error } = await fetchRichTransactionReviewRows(query, {
    onMissingSchemaColumn: schemaColumnState.markMissingSchemaColumn,
  });
  if (isMissingSchemaColumn(error, 'line_id')) {
    ({ data, error } = await runLegacyFallbackQuery(
      'FullNoLineId',
      TRANSACTION_REVIEW_SELECTORS.fullNoLineId,
      true,
      {
        selectStatement: TRANSACTION_REVIEW_SELECTORS.fullNoLineIdNoTaxAmount,
        stage: 'FullNoLineIdNoTaxAmount',
      }
    ));
  }
  if (isTransactionReviewSchemaCacheError(error)) {
    ({ data, error } = await runBaseFallbackQuery(
      'BaseWithDiscount',
      TRANSACTION_REVIEW_SELECTORS.baseWithDiscount,
      true,
      {
        selectStatement:
          TRANSACTION_REVIEW_SELECTORS.baseWithDiscountNoTaxAmount,
        stage: 'BaseWithDiscountNoTaxAmount',
      }
    ));
  }
  if (isTransactionReviewSchemaCacheError(error)) {
    ({ data, error } = await runBaseFallbackQuery(
      'Base',
      TRANSACTION_REVIEW_SELECTORS.base,
      true
    ));
  }
  if (isTransactionReviewSchemaCacheError(error)) {
    ({ data, error } = await runLegacyFallbackQuery(
      'Legacy',
      TRANSACTION_REVIEW_SELECTORS.legacyCompat,
      false,
      {
        selectStatement: TRANSACTION_REVIEW_SELECTORS.legacyCompatNoTaxAmount,
        stage: 'LegacyCompatNoTaxAmount',
      }
    ));
  }
  if (isTransactionReviewSchemaCacheError(error)) {
    ({ data, error } = await runBaseFallbackQuery(
      'BaseWithDiscount',
      TRANSACTION_REVIEW_SELECTORS.baseWithDiscountCompat,
      false,
      {
        selectStatement:
          TRANSACTION_REVIEW_SELECTORS.baseWithDiscountCompatNoTaxAmount,
        stage: 'BaseWithDiscountCompatNoTaxAmount',
      }
    ));
  }
  if (isTransactionReviewSchemaCacheError(error)) {
    ({ data, error } = await runBaseFallbackQuery(
      'Base',
      TRANSACTION_REVIEW_SELECTORS.baseCompat,
      false
    ));
  }
  if (isTransactionReviewSchemaCacheError(error)) {
    ({ data, error } = await runBaseFallbackQuery(
      'Base',
      TRANSACTION_REVIEW_SELECTORS.noDiscount,
      false
    ));
  }
  if (isTransactionReviewSchemaCacheError(error)) {
    ({ data, error } = await runBaseFallbackQuery(
      'BaseNoLineId',
      TRANSACTION_REVIEW_SELECTORS.baseWithDiscountNoLineId,
      true,
      {
        selectStatement:
          TRANSACTION_REVIEW_SELECTORS.baseWithDiscountNoLineIdNoTaxAmount,
        stage: 'BaseNoLineIdNoTaxAmount',
      }
    ));
  }
  if (isTransactionReviewSchemaCacheError(error)) {
    ({ data, error } = await runBaseFallbackQuery(
      'BaseNoLineId',
      TRANSACTION_REVIEW_SELECTORS.noLineId,
      false
    ));
  }
  if (isTransactionReviewSchemaCacheError(error)) {
    ({ data, error } = await runBaseFallbackQuery(
      'BaseNoVariantId',
      TRANSACTION_REVIEW_SELECTORS.baseWithDiscountNoVariantId,
      true,
      {
        selectStatement:
          TRANSACTION_REVIEW_SELECTORS.baseWithDiscountNoVariantIdNoTaxAmount,
        stage: 'BaseNoVariantIdNoTaxAmount',
      }
    ));
  }
  if (isTransactionReviewSchemaCacheError(error)) {
    ({ data, error } = await runBaseFallbackQuery(
      'BaseNoVariantId',
      TRANSACTION_REVIEW_SELECTORS.noVariantId,
      false
    ));
  }
  if (isTransactionReviewSchemaCacheError(error)) {
    ({ data, error } = await runBaseFallbackQuery(
      'BaseNoQuizAwardId',
      TRANSACTION_REVIEW_SELECTORS.noVariantIdNoQuizAwardId,
      false
    ));
  }
  return { data, error };
}
