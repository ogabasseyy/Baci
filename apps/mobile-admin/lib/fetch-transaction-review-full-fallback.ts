import {
  type FullFallbackFlags,
  getFullFallbackProjection,
} from './fetch-transaction-review-full-fallback-projection';
import type {
  TaxAmountFallback,
  TransactionReviewFallbackQuery,
  TransactionReviewQueryError,
  TransactionReviewQueryOptions,
  TransactionReviewQueryResult,
} from './transaction-review-fallback-types';

interface FullFallbackDependencies {
  isMissingSchemaColumn: (
    error: TransactionReviewQueryError,
    column: string
  ) => boolean;
  onMissingSchemaColumn?: (column: string) => void;
  runQueryWithTaxFallback: (
    stage: string,
    options: TransactionReviewQueryOptions,
    taxAmountFallback: TaxAmountFallback
  ) => Promise<TransactionReviewQueryResult>;
}

export async function fetchFullTransactionReviewRows(
  query: TransactionReviewFallbackQuery,
  {
    isMissingSchemaColumn,
    onMissingSchemaColumn,
    runQueryWithTaxFallback,
  }: FullFallbackDependencies
) {
  const {
    endDateFilter,
    endDateIso,
    merchantId,
    startDateFilter,
    startDateIso,
  } = query;
  const baseOptions = {
    endDateFilter,
    endDateIso,
    includeCancelledAt: true,
    merchantId,
    startDateFilter,
    startDateIso,
  };
  let flags: FullFallbackFlags = {
    adTrackingUnavailable: false,
    cancelledAtUnavailable: false,
    discountAmountUnavailable: false,
    discountCodeUnavailable: false,
    lineIdUnavailable: false,
    quizAwardIdUnavailable: false,
    quizAwardAmountUnavailable: false,
    transactionDateUnavailable: false,
    variantIdUnavailable: false,
  };
  const attemptedStages = new Set<string>();
  let projection = getFullFallbackProjection(flags);
  let data: TransactionReviewQueryResult['data'] = null;
  let error: TransactionReviewQueryResult['error'] = null;

  while (!attemptedStages.has(projection.stage)) {
    attemptedStages.add(projection.stage);
    ({ data, error } = await runQueryWithTaxFallback(
      projection.stage,
      {
        ...baseOptions,
        includeCancelledAt: !flags.cancelledAtUnavailable,
        includeTransactionDate: !flags.transactionDateUnavailable,
        selectStatement: projection.selectStatement,
      },
      {
        selectStatement: projection.selectStatementNoTaxAmount,
        stage: `${projection.stage}NoTaxAmount`,
      }
    ));

    const nextFlags = {
      adTrackingUnavailable:
        flags.adTrackingUnavailable ||
        isMissingSchemaColumn(error, 'ad_tracking'),
      cancelledAtUnavailable:
        flags.cancelledAtUnavailable ||
        isMissingSchemaColumn(error, 'cancelled_at'),
      discountAmountUnavailable:
        flags.discountAmountUnavailable ||
        isMissingSchemaColumn(error, 'discount_amount'),
      discountCodeUnavailable:
        flags.discountCodeUnavailable ||
        isMissingSchemaColumn(error, 'discount_code_id'),
      lineIdUnavailable:
        flags.lineIdUnavailable || isMissingSchemaColumn(error, 'line_id'),
      quizAwardIdUnavailable:
        flags.quizAwardIdUnavailable ||
        isMissingSchemaColumn(error, 'quiz_award_id'),
      quizAwardAmountUnavailable:
        flags.quizAwardAmountUnavailable ||
        isMissingSchemaColumn(error, 'quiz_award_amount'),
      transactionDateUnavailable:
        flags.transactionDateUnavailable ||
        isMissingSchemaColumn(error, 'transaction_date'),
      variantIdUnavailable:
        flags.variantIdUnavailable ||
        isMissingSchemaColumn(error, 'variant_id'),
    };
    if (nextFlags.quizAwardIdUnavailable && !flags.quizAwardIdUnavailable) {
      onMissingSchemaColumn?.('quiz_award_id');
    }
    if (
      nextFlags.quizAwardAmountUnavailable &&
      !flags.quizAwardAmountUnavailable
    ) {
      onMissingSchemaColumn?.('quiz_award_amount');
    }
    if (nextFlags.adTrackingUnavailable && !flags.adTrackingUnavailable) {
      onMissingSchemaColumn?.('ad_tracking');
    }
    if (nextFlags.cancelledAtUnavailable && !flags.cancelledAtUnavailable) {
      onMissingSchemaColumn?.('cancelled_at');
    }
    if (
      nextFlags.discountAmountUnavailable &&
      !flags.discountAmountUnavailable
    ) {
      onMissingSchemaColumn?.('discount_amount');
    }
    if (nextFlags.discountCodeUnavailable && !flags.discountCodeUnavailable) {
      onMissingSchemaColumn?.('discount_code_id');
    }
    if (nextFlags.lineIdUnavailable && !flags.lineIdUnavailable) {
      onMissingSchemaColumn?.('line_id');
    }
    if (nextFlags.variantIdUnavailable && !flags.variantIdUnavailable) {
      onMissingSchemaColumn?.('variant_id');
    }
    if (
      nextFlags.transactionDateUnavailable &&
      !flags.transactionDateUnavailable
    ) {
      onMissingSchemaColumn?.('transaction_date');
    }
    if (
      nextFlags.adTrackingUnavailable === flags.adTrackingUnavailable &&
      nextFlags.cancelledAtUnavailable === flags.cancelledAtUnavailable &&
      nextFlags.discountAmountUnavailable === flags.discountAmountUnavailable &&
      nextFlags.discountCodeUnavailable === flags.discountCodeUnavailable &&
      nextFlags.lineIdUnavailable === flags.lineIdUnavailable &&
      nextFlags.quizAwardIdUnavailable === flags.quizAwardIdUnavailable &&
      nextFlags.quizAwardAmountUnavailable ===
        flags.quizAwardAmountUnavailable &&
      nextFlags.transactionDateUnavailable ===
        flags.transactionDateUnavailable &&
      nextFlags.variantIdUnavailable === flags.variantIdUnavailable
    ) {
      break;
    }
    flags = nextFlags;
    projection = getFullFallbackProjection(flags);
  }

  return { data, error };
}
