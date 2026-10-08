import { fetchFullTransactionReviewRows } from './fetch-transaction-review-full-fallback';
import { isMissingSchemaColumn } from './is-missing-transaction-review-schema-column';
import { isTransactionReviewSchemaCacheError } from './is-transaction-review-schema-cache-error';
import { resolveTransactionReviewFallbackRetry } from './resolve-transaction-review-fallback-retry';
import { runLegacyTransactionReviewQuery } from './run-legacy-transaction-review-query';
import { runTransactionReviewQueryWithTaxFallback } from './run-transaction-review-query-with-tax-fallback';
import {
  omitUnavailableTransactionReviewSchemaColumns,
  type TransactionReviewFallbackCallbacks,
  withoutTransactionReviewSchemaColumn,
} from './transaction-review-fallback-schema-columns';
import type {
  TaxAmountFallback,
  TransactionReviewFallbackQuery,
  TransactionReviewFallbackStage,
} from './transaction-review-fallback-types';
import { TRANSACTION_REVIEW_SELECTORS } from './transaction-review-selectors';
/** Reads cost-rich rows before compatibility/base fallbacks. */
export async function fetchRichTransactionReviewRows(
  {
    fetchAll,
    endDateFilter,
    endDateIso,
    merchantId,
    orderIds,
    startDateFilter,
    startDateIso,
  }: TransactionReviewFallbackQuery,
  { onMissingSchemaColumn }: TransactionReviewFallbackCallbacks = {}
) {
  const legacyQuery = {
    ...(fetchAll ? { fetchAll } : {}),
    ...(orderIds ? { orderIds } : {}),
    endDateFilter,
    endDateIso,
    merchantId,
    startDateFilter,
    startDateIso,
  };
  const unavailableSchemaColumns = new Set<string>();
  const markUnavailableSchemaColumn = (column: string) => {
    unavailableSchemaColumns.add(column);
  };
  let { data, error } = await fetchFullTransactionReviewRows(legacyQuery, {
    isMissingSchemaColumn,
    onMissingSchemaColumn: (column) => {
      markUnavailableSchemaColumn(column);
      onMissingSchemaColumn?.(column);
    },
    runQueryWithTaxFallback: runTransactionReviewQueryWithTaxFallback,
  });
  if (isMissingSchemaColumn(error, 'variant_attributes')) {
    markUnavailableSchemaColumn('variant_attributes');
    onMissingSchemaColumn?.('variant_attributes');
  }
  if (isMissingSchemaColumn(error, 'quiz_award_amount')) {
    markUnavailableSchemaColumn('quiz_award_amount');
    onMissingSchemaColumn?.('quiz_award_amount');
  }
  if (isMissingSchemaColumn(error, 'product_match_status')) {
    markUnavailableSchemaColumn('product_match_status');
  }
  if (isMissingSchemaColumn(error, 'discount_code_id')) {
    markUnavailableSchemaColumn('discount_code_id');
  }
  if (isMissingSchemaColumn(error, 'order_item_unit_costs')) {
    markUnavailableSchemaColumn('order_item_unit_costs');
  }
  const runLegacyFallbackQuery = async (
    stage: TransactionReviewFallbackStage,
    selectStatement: string,
    taxAmountFallback?: TaxAmountFallback
  ) => {
    const omitUnavailableSchemaColumns = (selector: string) =>
      omitUnavailableTransactionReviewSchemaColumns(
        selector,
        unavailableSchemaColumns
      );
    const runQuery = () =>
      runLegacyTransactionReviewQuery(
        stage,
        legacyQuery,
        omitUnavailableSchemaColumns(selectStatement),
        !unavailableSchemaColumns.has('cancelled_at'),
        taxAmountFallback
          ? {
              ...taxAmountFallback,
              selectStatement: omitUnavailableSchemaColumns(
                taxAmountFallback.selectStatement
              ),
            }
          : undefined,
        !unavailableSchemaColumns.has('transaction_date')
      );
    let result = await runQuery();
    while (true) {
      const shouldRetry = resolveTransactionReviewFallbackRetry({
        error: result.error,
        markUnavailableSchemaColumn,
        onMissingSchemaColumn,
        stage,
        unavailableSchemaColumns,
      });
      if (!shouldRetry) {
        break;
      }
      result = await runQuery();
    }
    return result;
  };
  if (isMissingSchemaColumn(error, 'variant_attributes')) {
    const variantAttributesSelector = unavailableSchemaColumns.has(
      'product_match_status'
    )
      ? unavailableSchemaColumns.has('discount_code_id')
        ? TRANSACTION_REVIEW_SELECTORS.legacyNoVariantAttributesNoProductMatchStatusNoDiscountCode
        : TRANSACTION_REVIEW_SELECTORS.legacyNoVariantAttributesNoProductMatchStatus
      : unavailableSchemaColumns.has('discount_code_id')
        ? TRANSACTION_REVIEW_SELECTORS.legacyNoVariantAttributesNoDiscountCode
        : TRANSACTION_REVIEW_SELECTORS.legacyNoVariantAttributes;
    const variantAttributesSelectorNoTaxAmount =
      withoutTransactionReviewSchemaColumn(
        variantAttributesSelector,
        'tax_amount'
      );
    ({ data, error } = await runLegacyFallbackQuery(
      'LegacyNoVariantAttributes',
      variantAttributesSelector,
      {
        selectStatement: variantAttributesSelectorNoTaxAmount,
        stage: 'LegacyNoVariantAttributesNoTaxAmount',
      }
    ));
    if (isMissingSchemaColumn(error, 'order_item_unit_costs')) {
      const noLaterFieldsSelector = unavailableSchemaColumns.has(
        'product_match_status'
      )
        ? TRANSACTION_REVIEW_SELECTORS.legacyNoVariantAttributesNoProductMatchStatusNoLaterFields
        : TRANSACTION_REVIEW_SELECTORS.legacyNoVariantAttributesNoLaterFields;
      const noLaterFieldsSelectorNoTaxAmount =
        withoutTransactionReviewSchemaColumn(
          noLaterFieldsSelector,
          'tax_amount'
        );
      ({ data, error } = await runLegacyFallbackQuery(
        'LegacyNoVariantAttributesNoLaterFields',
        noLaterFieldsSelector,
        {
          selectStatement: noLaterFieldsSelectorNoTaxAmount,
          stage: 'LegacyNoVariantAttributesNoLaterFieldsNoTaxAmount',
        }
      ));
    }
  }
  if (isMissingSchemaColumn(error, 'product_match_status')) {
    ({ data, error } = await runLegacyFallbackQuery(
      'LegacyNoProductMatchStatus',
      TRANSACTION_REVIEW_SELECTORS.legacyNoProductMatchStatus,
      {
        selectStatement:
          TRANSACTION_REVIEW_SELECTORS.legacyNoProductMatchStatusNoTaxAmount,
        stage: 'LegacyNoProductMatchStatusNoTaxAmount',
      }
    ));
  }
  if (isTransactionReviewSchemaCacheError(error)) {
    ({ data, error } = await runLegacyFallbackQuery(
      'Legacy',
      TRANSACTION_REVIEW_SELECTORS.legacy,
      {
        selectStatement: TRANSACTION_REVIEW_SELECTORS.legacyNoTaxAmount,
        stage: 'LegacyNoTaxAmount',
      }
    ));
  }
  if (isTransactionReviewSchemaCacheError(error)) {
    ({ data, error } = await runLegacyFallbackQuery(
      'LegacyNoAdjustments',
      TRANSACTION_REVIEW_SELECTORS.legacyNoAdjustments,
      {
        selectStatement:
          TRANSACTION_REVIEW_SELECTORS.legacyNoAdjustmentsNoTaxAmount,
        stage: 'LegacyNoAdjustmentsNoTaxAmount',
      }
    ));
  }
  if (isMissingSchemaColumn(error, 'discount_code_id')) {
    ({ data, error } = await runLegacyFallbackQuery(
      'LegacyNoDiscountCode',
      TRANSACTION_REVIEW_SELECTORS.legacyNoDiscountCode,
      {
        selectStatement:
          TRANSACTION_REVIEW_SELECTORS.legacyNoDiscountCodeNoTaxAmount,
        stage: 'LegacyNoDiscountCodeNoTaxAmount',
      }
    ));
    if (isTransactionReviewSchemaCacheError(error)) {
      ({ data, error } = await runLegacyFallbackQuery(
        'LegacyNoAdjustmentsNoDiscountCode',
        TRANSACTION_REVIEW_SELECTORS.legacyNoAdjustmentsNoDiscountCode,
        {
          selectStatement:
            TRANSACTION_REVIEW_SELECTORS.legacyNoAdjustmentsNoDiscountCodeNoTaxAmount,
          stage: 'LegacyNoAdjustmentsNoDiscountCodeNoTaxAmount',
        }
      ));
    }
  }
  return { data, error };
}
