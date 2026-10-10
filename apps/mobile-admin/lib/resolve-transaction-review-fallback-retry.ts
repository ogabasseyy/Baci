import { isMissingSchemaColumn } from './is-missing-transaction-review-schema-column';
import type {
  TransactionReviewFallbackStage,
  TransactionReviewQueryError,
} from './transaction-review-fallback-types';

const RETRYABLE_FALLBACK_COLUMNS = [
  'order_item_unit_costs',
  'quiz_award_id',
  'quiz_award_amount',
  'line_id',
  'offer_id',
  'ad_tracking',
  'cancelled_at',
  'variant_attributes',
  'variant_id',
  'product_match_status',
  'offer_grade',
  'offer_condition_notes',
] as const;

/** Marks newly missing columns and reports whether to retry the fallback query. */
export function resolveTransactionReviewFallbackRetry({
  error,
  markUnavailableSchemaColumn,
  onMissingSchemaColumn,
  stage,
  unavailableSchemaColumns,
}: {
  error: TransactionReviewQueryError;
  markUnavailableSchemaColumn: (column: string) => void;
  onMissingSchemaColumn?: (column: string) => void;
  stage: TransactionReviewFallbackStage;
  unavailableSchemaColumns: Set<string>;
}) {
  let shouldRetry = false;
  const markColumn = (column: string) => {
    if (unavailableSchemaColumns.has(column)) {
      return;
    }
    if (!isMissingSchemaColumn(error, column)) {
      return;
    }
    markUnavailableSchemaColumn(column);
    onMissingSchemaColumn?.(column);
    shouldRetry = true;
  };

  for (const column of RETRYABLE_FALLBACK_COLUMNS) {
    markColumn(column);
  }

  if (
    !unavailableSchemaColumns.has('discount_code_id') &&
    isMissingSchemaColumn(error, 'discount_code_id') &&
    (stage.includes('VariantAttributes') ||
      stage === 'LegacyNoProductMatchStatus' ||
      unavailableSchemaColumns.has('order_item_unit_costs'))
  ) {
    markUnavailableSchemaColumn('discount_code_id');
    onMissingSchemaColumn?.('discount_code_id');
    shouldRetry = true;
  }

  markColumn('discount_amount');
  markColumn('transaction_date');

  return shouldRetry;
}
