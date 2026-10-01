export type TransactionReviewSchemaColumnAvailability = Readonly<{
  adTrackingUnavailable: boolean;
  cancelledAtUnavailable: boolean;
  discountAmountUnavailable: boolean;
  discountCodeUnavailable: boolean;
  lineIdUnavailable: boolean;
  productMatchStatusUnavailable?: boolean;
  quizAwardIdUnavailable: boolean;
  quizAwardAmountUnavailable?: boolean;
  transactionDateUnavailable: boolean;
  unitCostRelationshipUnavailable?: boolean;
  variantAttributesUnavailable?: boolean;
  variantIdUnavailable: boolean;
}>;

type SchemaColumnAvailabilityKey =
  keyof TransactionReviewSchemaColumnAvailability;

const schemaColumnAvailabilityKeys: Readonly<
  Record<string, SchemaColumnAvailabilityKey>
> = {
  ad_tracking: 'adTrackingUnavailable',
  cancelled_at: 'cancelledAtUnavailable',
  discount_amount: 'discountAmountUnavailable',
  discount_code_id: 'discountCodeUnavailable',
  line_id: 'lineIdUnavailable',
  product_match_status: 'productMatchStatusUnavailable',
  quiz_award_amount: 'quizAwardAmountUnavailable',
  quiz_award_id: 'quizAwardIdUnavailable',
  transaction_date: 'transactionDateUnavailable',
  order_item_unit_costs: 'unitCostRelationshipUnavailable',
  variant_attributes: 'variantAttributesUnavailable',
  variant_id: 'variantIdUnavailable',
};

/** Tracks schema drift discovered while walking transaction-review fallbacks. */
export function createTransactionReviewSchemaColumnState() {
  const availability: Record<SchemaColumnAvailabilityKey, boolean> = {
    adTrackingUnavailable: false,
    cancelledAtUnavailable: false,
    discountAmountUnavailable: false,
    discountCodeUnavailable: false,
    lineIdUnavailable: false,
    productMatchStatusUnavailable: false,
    quizAwardAmountUnavailable: false,
    quizAwardIdUnavailable: false,
    transactionDateUnavailable: false,
    unitCostRelationshipUnavailable: false,
    variantAttributesUnavailable: false,
    variantIdUnavailable: false,
  };

  const markMissingSchemaColumn = (column: string) => {
    const key = schemaColumnAvailabilityKeys[column];
    if (!key || availability[key]) return false;
    availability[key] = true;
    return true;
  };

  const getSchemaColumnAvailability =
    (): TransactionReviewSchemaColumnAvailability => ({
      ...availability,
    });

  return {
    getSchemaColumnAvailability,
    markMissingSchemaColumn,
    omitUnavailableSchemaColumns: (selector: string) =>
      omitUnavailableTransactionReviewSchemaColumns(
        selector,
        getSchemaColumnAvailability()
      ),
  };
}

type SchemaColumnAvailability =
  | TransactionReviewSchemaColumnAvailability
  | ReadonlySet<string>;

function withoutSchemaColumn(selector: string, column: string) {
  return selector.replace(`, ${column}`, '');
}

function withoutVariantRelationship(selector: string) {
  return withoutSchemaColumn(
    selector.replace(
      ', product_variants(cost_price, sku, attributes, condition)',
      ''
    ),
    'variant_id'
  );
}

export function omitUnavailableTransactionReviewSchemaColumns(
  selector: string,
  availability: SchemaColumnAvailability
) {
  const isUnavailable = (
    key: keyof TransactionReviewSchemaColumnAvailability,
    column: string
  ) => {
    if (availability instanceof Set) return availability.has(column);
    return Boolean(
      (availability as TransactionReviewSchemaColumnAvailability)[key]
    );
  };
  let result = selector;
  if (isUnavailable('quizAwardIdUnavailable', 'quiz_award_id')) {
    result = withoutSchemaColumn(result, 'quiz_award_id');
  }
  if (isUnavailable('quizAwardAmountUnavailable', 'quiz_award_amount')) {
    result = withoutSchemaColumn(result, 'quiz_award_amount');
  }
  if (isUnavailable('discountCodeUnavailable', 'discount_code_id')) {
    result = withoutSchemaColumn(result, 'discount_code_id');
  }
  if (isUnavailable('discountAmountUnavailable', 'discount_amount')) {
    result = withoutSchemaColumn(result, 'discount_amount');
  }
  if (isUnavailable('lineIdUnavailable', 'line_id')) {
    result = withoutSchemaColumn(result, 'line_id');
  }
  if (isUnavailable('adTrackingUnavailable', 'ad_tracking')) {
    result = withoutSchemaColumn(result, 'ad_tracking');
  }
  if (isUnavailable('cancelledAtUnavailable', 'cancelled_at')) {
    result = withoutSchemaColumn(result, 'cancelled_at');
  }
  if (isUnavailable('transactionDateUnavailable', 'transaction_date')) {
    result = withoutSchemaColumn(result, 'transaction_date');
  }
  if (isUnavailable('variantIdUnavailable', 'variant_id')) {
    result = withoutVariantRelationship(result);
  }
  if (isUnavailable('variantAttributesUnavailable', 'variant_attributes')) {
    result = withoutSchemaColumn(result, 'variant_attributes');
  }
  if (isUnavailable('productMatchStatusUnavailable', 'product_match_status')) {
    result = withoutSchemaColumn(result, 'product_match_status');
  }
  if (
    isUnavailable('unitCostRelationshipUnavailable', 'order_item_unit_costs')
  ) {
    result = result.replace(/, order_item_unit_costs\([^)]*\)/, '');
  }
  return result;
}
export type TransactionReviewFallbackCallbacks = Readonly<{
  onMissingSchemaColumn?: (column: string) => void;
}>;

export const withoutTransactionReviewSchemaColumn = (
  selector: string,
  column: string
) => selector.replace(`, ${column}`, '');
