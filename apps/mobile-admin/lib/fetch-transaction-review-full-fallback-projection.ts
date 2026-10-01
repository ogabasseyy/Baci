import { TRANSACTION_REVIEW_SELECTORS } from './transaction-review-selectors';

export type FullFallbackFlags = Readonly<{
  adTrackingUnavailable: boolean;
  cancelledAtUnavailable: boolean;
  discountAmountUnavailable: boolean;
  discountCodeUnavailable: boolean;
  lineIdUnavailable: boolean;
  quizAwardIdUnavailable: boolean;
  quizAwardAmountUnavailable: boolean;
  transactionDateUnavailable: boolean;
  variantIdUnavailable: boolean;
}>;

type FullFallbackProjection = Readonly<{
  selectStatement: string;
  selectStatementNoTaxAmount: string;
  stage: string;
}>;

function withoutLineId(selector: string) {
  return selector.replace('order_items(id, line_id, ', 'order_items(id, ');
}

function withoutTransactionDate(selector: string) {
  return selector.replace(', transaction_date', '');
}

function withoutQuizAwardId(selector: string) {
  return selector.replace(', quiz_award_id', '');
}

function withoutQuizAwardAmount(selector: string) {
  return selector.replace(', quiz_award_amount', '');
}

function withoutAdTracking(selector: string) {
  return selector.replace(', ad_tracking', '');
}

function withoutCancelledAt(selector: string) {
  return selector.replace(', cancelled_at', '');
}

function applyMissingColumns(
  projection: FullFallbackProjection,
  flags: FullFallbackFlags
): FullFallbackProjection {
  let selectStatement = projection.selectStatement;
  let selectStatementNoTaxAmount = projection.selectStatementNoTaxAmount;
  let stage = projection.stage;

  if (flags.lineIdUnavailable) {
    selectStatement = withoutLineId(selectStatement);
    selectStatementNoTaxAmount = withoutLineId(selectStatementNoTaxAmount);
    stage = `${stage}NoLineId`;
  }
  if (flags.transactionDateUnavailable) {
    selectStatement = withoutTransactionDate(selectStatement);
    selectStatementNoTaxAmount = withoutTransactionDate(
      selectStatementNoTaxAmount
    );
    stage = `${stage}NoTransactionDate`;
  }
  if (flags.quizAwardIdUnavailable) {
    selectStatement = withoutQuizAwardId(selectStatement);
    selectStatementNoTaxAmount = withoutQuizAwardId(selectStatementNoTaxAmount);
    stage = `${stage}NoQuizAwardId`;
  }
  if (flags.quizAwardAmountUnavailable) {
    selectStatement = withoutQuizAwardAmount(selectStatement);
    selectStatementNoTaxAmount = withoutQuizAwardAmount(
      selectStatementNoTaxAmount
    );
    stage = `${stage}NoQuizAwardAmount`;
  }
  if (flags.adTrackingUnavailable) {
    selectStatement = withoutAdTracking(selectStatement);
    selectStatementNoTaxAmount = withoutAdTracking(selectStatementNoTaxAmount);
    stage = `${stage}NoAdTracking`;
  }
  if (flags.cancelledAtUnavailable) {
    selectStatement = withoutCancelledAt(selectStatement);
    selectStatementNoTaxAmount = withoutCancelledAt(selectStatementNoTaxAmount);
    stage = `${stage}NoCancelledAt`;
  }

  return {
    selectStatement,
    selectStatementNoTaxAmount,
    stage,
  };
}

export function getFullFallbackProjection(
  flags: FullFallbackFlags
): FullFallbackProjection {
  const {
    discountAmountUnavailable,
    discountCodeUnavailable,
    variantIdUnavailable,
  } = flags;

  const projection = (() => {
    if (variantIdUnavailable && discountCodeUnavailable) {
      return discountAmountUnavailable
        ? {
            selectStatement:
              TRANSACTION_REVIEW_SELECTORS.fullNoVariantIdNoDiscountCodeNoDiscount,
            selectStatementNoTaxAmount:
              TRANSACTION_REVIEW_SELECTORS.fullNoVariantIdNoDiscountCodeNoDiscountNoTaxAmount,
            stage: 'FullNoVariantIdNoDiscountCodeNoDiscount',
          }
        : {
            selectStatement:
              TRANSACTION_REVIEW_SELECTORS.fullNoVariantIdNoDiscountCode,
            selectStatementNoTaxAmount:
              TRANSACTION_REVIEW_SELECTORS.fullNoVariantIdNoDiscountCodeNoTaxAmount,
            stage: 'FullNoVariantIdNoDiscountCode',
          };
    }

    if (variantIdUnavailable && discountAmountUnavailable) {
      return {
        selectStatement: TRANSACTION_REVIEW_SELECTORS.fullNoVariantIdNoDiscount,
        selectStatementNoTaxAmount:
          TRANSACTION_REVIEW_SELECTORS.fullNoVariantIdNoDiscountNoTaxAmount,
        stage: 'FullNoVariantIdNoDiscount',
      };
    }

    if (discountCodeUnavailable && discountAmountUnavailable) {
      return {
        selectStatement:
          TRANSACTION_REVIEW_SELECTORS.fullNoDiscountCodeNoDiscount,
        selectStatementNoTaxAmount:
          TRANSACTION_REVIEW_SELECTORS.fullNoDiscountCodeNoDiscountNoTaxAmount,
        stage: 'FullNoDiscountCodeNoDiscount',
      };
    }

    if (variantIdUnavailable) {
      return {
        selectStatement: TRANSACTION_REVIEW_SELECTORS.fullNoVariantId,
        selectStatementNoTaxAmount:
          TRANSACTION_REVIEW_SELECTORS.fullNoVariantIdNoTaxAmount,
        stage: 'FullNoVariantId',
      };
    }

    if (discountCodeUnavailable) {
      return {
        selectStatement: TRANSACTION_REVIEW_SELECTORS.fullNoDiscountCode,
        selectStatementNoTaxAmount:
          TRANSACTION_REVIEW_SELECTORS.fullNoDiscountCodeNoTaxAmount,
        stage: 'FullNoDiscountCode',
      };
    }

    if (discountAmountUnavailable) {
      return {
        selectStatement: TRANSACTION_REVIEW_SELECTORS.fullNoDiscount,
        selectStatementNoTaxAmount:
          TRANSACTION_REVIEW_SELECTORS.fullNoDiscountNoTaxAmount,
        stage: 'FullNoDiscount',
      };
    }

    return {
      selectStatement: TRANSACTION_REVIEW_SELECTORS.full,
      selectStatementNoTaxAmount: TRANSACTION_REVIEW_SELECTORS.fullNoTaxAmount,
      stage: 'Full',
    };
  })();

  return applyMissingColumns(projection, flags);
}
