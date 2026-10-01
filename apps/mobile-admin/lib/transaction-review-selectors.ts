function withoutTaxAmount(selector: string) {
  return selector.replace(', tax_amount', '');
}

function withoutLineId(selector: string) {
  return selector.replace('order_items(id, line_id, ', 'order_items(id, ');
}

function withoutTransactionDate(selector: string) {
  return selector.replace(', transaction_date', '');
}

function withoutCancelledAt(selector: string) {
  return selector.replace(', cancelled_at', '');
}

function withoutVariantId(selector: string) {
  return selector.replace(', variant_id', '');
}

function withoutProductVariants(selector: string) {
  return selector.replace(
    ', product_variants(cost_price, sku, attributes, condition)',
    ''
  );
}

function withoutVariantRelationship(selector: string) {
  return withoutProductVariants(withoutVariantId(selector));
}

function withoutQuizAwardId(selector: string) {
  return selector.replace(', quiz_award_id', '');
}

function withoutDiscountAmount(selector: string) {
  return selector.replace(', discount_amount', '');
}

function withoutDiscountCode(selector: string) {
  return selector.replace(', discount_code_id', '');
}

function withoutProductMatchStatus(selector: string) {
  return selector.replace(', product_match_status', '');
}

function withoutAdTracking(selector: string) {
  return selector.replace(', ad_tracking', '');
}

const transactionReviewSelectors = {
  base: 'id, order_number, created_at, shipping_status, cancelled_at, customer_name, customer_email, customer_phone, payment_method, total, external_source, fulfillment_details, order_items(id, line_id, product_id, variant_id, quiz_award_id, quiz_award_amount, condition, variant_attributes, name, price, quantity, fulfillment_data, products(cost_price, metadata, sku, fulfillment_details))',
  baseCompat:
    'id, order_number, created_at, shipping_status, customer_name, customer_email, customer_phone, payment_method, total, external_source, fulfillment_details, order_items(id, line_id, product_id, variant_id, quiz_award_id, quiz_award_amount, condition, variant_attributes, name, price, quantity, fulfillment_data, products(cost_price, metadata, sku, fulfillment_details))',
  baseWithDiscount:
    'id, order_number, created_at, shipping_status, cancelled_at, customer_name, customer_email, customer_phone, payment_method, total, discount_amount, discount_code_id, tax_amount, source, external_source, ad_tracking, fulfillment_details, order_items(id, line_id, product_id, variant_id, quiz_award_id, quiz_award_amount, condition, variant_attributes, name, price, quantity, assurance_fee, fulfillment_data, products(cost_price, metadata, sku, fulfillment_details))',
  baseWithDiscountCompat:
    'id, order_number, created_at, shipping_status, customer_name, customer_email, customer_phone, payment_method, total, discount_amount, discount_code_id, tax_amount, source, external_source, ad_tracking, fulfillment_details, order_items(id, line_id, product_id, variant_id, quiz_award_id, quiz_award_amount, condition, variant_attributes, name, price, quantity, assurance_fee, fulfillment_data, products(cost_price, metadata, sku, fulfillment_details))',
  baseWithDiscountNoLineId:
    'id, order_number, created_at, shipping_status, cancelled_at, customer_name, customer_email, customer_phone, payment_method, total, discount_amount, discount_code_id, tax_amount, source, external_source, ad_tracking, fulfillment_details, order_items(id, product_id, variant_id, quiz_award_id, quiz_award_amount, condition, variant_attributes, name, price, quantity, assurance_fee, fulfillment_data, products(cost_price, metadata, sku, fulfillment_details))',
  baseWithDiscountNoVariantId:
    'id, order_number, created_at, shipping_status, cancelled_at, customer_name, customer_email, customer_phone, payment_method, total, discount_amount, discount_code_id, tax_amount, source, external_source, ad_tracking, fulfillment_details, order_items(id, line_id, product_id, quiz_award_id, quiz_award_amount, condition, variant_attributes, name, price, quantity, assurance_fee, fulfillment_data, products(cost_price, metadata, sku, fulfillment_details))',
  full: 'id, order_number, created_at, transaction_date, shipping_status, cancelled_at, customer_name, customer_email, customer_phone, payment_method, total, discount_amount, discount_code_id, tax_amount, source, external_source, ad_tracking, fulfillment_details, order_items(id, line_id, product_id, variant_id, quiz_award_id, quiz_award_amount, condition, variant_attributes, product_match_status, name, price, quantity, cost_price, assurance_fee, vat_category_code, vat_rate, supplier_name, fulfillment_data, order_item_unit_costs(unit_index, cost_price, supplier_name, identifier_type, identifier_value), product_variants(cost_price, sku, attributes, condition), products(cost_price, metadata, sku, fulfillment_details))',
  fullNoDiscountCode:
    'id, order_number, created_at, transaction_date, shipping_status, cancelled_at, customer_name, customer_email, customer_phone, payment_method, total, discount_amount, tax_amount, source, external_source, ad_tracking, fulfillment_details, order_items(id, line_id, product_id, variant_id, quiz_award_id, quiz_award_amount, condition, variant_attributes, product_match_status, name, price, quantity, cost_price, assurance_fee, vat_category_code, vat_rate, supplier_name, fulfillment_data, order_item_unit_costs(unit_index, cost_price, supplier_name, identifier_type, identifier_value), product_variants(cost_price, sku, attributes, condition), products(cost_price, metadata, sku, fulfillment_details))',
  fullNoDiscount:
    'id, order_number, created_at, transaction_date, shipping_status, cancelled_at, customer_name, customer_email, customer_phone, payment_method, total, discount_code_id, tax_amount, source, external_source, ad_tracking, fulfillment_details, order_items(id, line_id, product_id, variant_id, quiz_award_id, quiz_award_amount, condition, variant_attributes, product_match_status, name, price, quantity, cost_price, assurance_fee, vat_category_code, vat_rate, supplier_name, fulfillment_data, order_item_unit_costs(unit_index, cost_price, supplier_name, identifier_type, identifier_value), product_variants(cost_price, sku, attributes, condition), products(cost_price, metadata, sku, fulfillment_details))',
  legacy:
    'id, order_number, created_at, transaction_date, shipping_status, cancelled_at, customer_name, customer_email, customer_phone, payment_method, total, discount_amount, discount_code_id, tax_amount, source, external_source, ad_tracking, fulfillment_details, order_items(id, line_id, product_id, variant_id, quiz_award_id, quiz_award_amount, condition, variant_attributes, product_match_status, name, price, quantity, cost_price, assurance_fee, vat_category_code, vat_rate, supplier_name, fulfillment_data, product_variants(cost_price, sku, attributes, condition), products(cost_price, metadata, sku, fulfillment_details))',
  legacyNoVariantAttributes:
    'id, order_number, created_at, transaction_date, shipping_status, cancelled_at, customer_name, customer_email, customer_phone, payment_method, total, discount_amount, discount_code_id, tax_amount, source, external_source, ad_tracking, fulfillment_details, order_items(id, line_id, product_id, variant_id, quiz_award_id, quiz_award_amount, condition, product_match_status, name, price, quantity, cost_price, assurance_fee, vat_category_code, vat_rate, supplier_name, fulfillment_data, order_item_unit_costs(unit_index, cost_price, supplier_name, identifier_type, identifier_value), product_variants(cost_price, sku, attributes, condition), products(cost_price, metadata, sku, fulfillment_details))',
  legacyNoVariantAttributesNoLaterFields:
    'id, order_number, created_at, transaction_date, shipping_status, cancelled_at, customer_name, customer_email, customer_phone, payment_method, total, discount_amount, tax_amount, source, external_source, ad_tracking, fulfillment_details, order_items(id, line_id, product_id, variant_id, quiz_award_id, quiz_award_amount, condition, product_match_status, name, price, quantity, cost_price, assurance_fee, vat_category_code, vat_rate, supplier_name, fulfillment_data, product_variants(cost_price, sku, attributes, condition), products(cost_price, metadata, sku, fulfillment_details))',
  legacyNoProductMatchStatus:
    'id, order_number, created_at, transaction_date, shipping_status, cancelled_at, customer_name, customer_email, customer_phone, payment_method, total, discount_amount, discount_code_id, tax_amount, source, external_source, ad_tracking, fulfillment_details, order_items(id, line_id, product_id, variant_id, quiz_award_id, quiz_award_amount, condition, variant_attributes, name, price, quantity, cost_price, assurance_fee, vat_category_code, vat_rate, supplier_name, fulfillment_data, order_item_unit_costs(unit_index, cost_price, supplier_name, identifier_type, identifier_value), product_variants(cost_price, sku, attributes, condition), products(cost_price, metadata, sku, fulfillment_details))',
  legacyNoAdjustments:
    'id, order_number, created_at, transaction_date, shipping_status, cancelled_at, customer_name, customer_email, customer_phone, payment_method, total, discount_amount, discount_code_id, tax_amount, source, external_source, ad_tracking, fulfillment_details, order_items(id, line_id, product_id, variant_id, quiz_award_id, quiz_award_amount, condition, variant_attributes, product_match_status, name, price, quantity, cost_price, supplier_name, fulfillment_data, order_item_unit_costs(unit_index, cost_price, supplier_name, identifier_type, identifier_value), product_variants(cost_price, sku, attributes, condition), products(cost_price, metadata, sku, fulfillment_details))',
  legacyNoDiscountCode:
    'id, order_number, created_at, transaction_date, shipping_status, cancelled_at, customer_name, customer_email, customer_phone, payment_method, total, discount_amount, tax_amount, source, external_source, ad_tracking, fulfillment_details, order_items(id, line_id, product_id, variant_id, quiz_award_id, quiz_award_amount, condition, variant_attributes, product_match_status, name, price, quantity, cost_price, assurance_fee, vat_category_code, vat_rate, supplier_name, fulfillment_data, order_item_unit_costs(unit_index, cost_price, supplier_name, identifier_type, identifier_value), product_variants(cost_price, sku, attributes, condition), products(cost_price, metadata, sku, fulfillment_details))',
  legacyNoAdjustmentsNoDiscountCode:
    'id, order_number, created_at, transaction_date, shipping_status, cancelled_at, customer_name, customer_email, customer_phone, payment_method, total, discount_amount, tax_amount, source, external_source, ad_tracking, fulfillment_details, order_items(id, line_id, product_id, variant_id, quiz_award_id, quiz_award_amount, condition, variant_attributes, product_match_status, name, price, quantity, cost_price, supplier_name, fulfillment_data, order_item_unit_costs(unit_index, cost_price, supplier_name, identifier_type, identifier_value), product_variants(cost_price, sku, attributes, condition), products(cost_price, metadata, sku, fulfillment_details))',
  legacyCompat:
    'id, order_number, created_at, transaction_date, shipping_status, customer_name, customer_email, customer_phone, payment_method, total, discount_amount, discount_code_id, tax_amount, source, external_source, ad_tracking, fulfillment_details, order_items(id, line_id, product_id, variant_id, quiz_award_id, quiz_award_amount, condition, variant_attributes, name, price, quantity, cost_price, assurance_fee, vat_category_code, vat_rate, supplier_name, fulfillment_data, product_variants(cost_price, sku, attributes, condition), products(cost_price, metadata, sku, fulfillment_details))',
  noDiscount:
    'id, order_number, created_at, shipping_status, customer_name, customer_email, customer_phone, payment_method, total, external_source, fulfillment_details, order_items(id, line_id, product_id, variant_id, quiz_award_id, quiz_award_amount, condition, variant_attributes, name, price, quantity, fulfillment_data, products(cost_price, metadata, sku, fulfillment_details))',
  noLineId:
    'id, order_number, created_at, shipping_status, customer_name, customer_email, customer_phone, payment_method, total, external_source, fulfillment_details, order_items(id, product_id, variant_id, quiz_award_id, quiz_award_amount, condition, variant_attributes, name, price, quantity, fulfillment_data, products(cost_price, metadata, sku, fulfillment_details))',
  noVariantId:
    'id, order_number, created_at, shipping_status, customer_name, customer_email, customer_phone, payment_method, total, discount_amount, source, external_source, fulfillment_details, order_items(id, product_id, quiz_award_id, quiz_award_amount, name, price, quantity, fulfillment_data, products(cost_price, metadata, sku, fulfillment_details))',
  noVariantIdNoQuizAwardId:
    'id, order_number, created_at, shipping_status, customer_name, customer_email, customer_phone, payment_method, total, discount_amount, source, external_source, fulfillment_details, order_items(id, product_id, name, price, quantity, fulfillment_data, products(cost_price, metadata, sku, fulfillment_details))',
} as const;

export const TRANSACTION_REVIEW_SELECTORS = {
  ...transactionReviewSelectors,
  baseWithDiscountNoTaxAmount: withoutTaxAmount(
    transactionReviewSelectors.baseWithDiscount
  ),
  baseWithDiscountCompatNoTaxAmount: withoutTaxAmount(
    transactionReviewSelectors.baseWithDiscountCompat
  ),
  baseWithDiscountNoDiscountCode: withoutDiscountCode(
    transactionReviewSelectors.baseWithDiscount
  ),
  baseWithDiscountNoDiscountCodeNoTaxAmount: withoutTaxAmount(
    withoutDiscountCode(transactionReviewSelectors.baseWithDiscount)
  ),
  baseWithDiscountCompatNoDiscountCode: withoutDiscountCode(
    transactionReviewSelectors.baseWithDiscountCompat
  ),
  baseWithDiscountCompatNoDiscountCodeNoTaxAmount: withoutTaxAmount(
    withoutDiscountCode(transactionReviewSelectors.baseWithDiscountCompat)
  ),
  baseWithDiscountNoLineIdNoTaxAmount: withoutTaxAmount(
    transactionReviewSelectors.baseWithDiscountNoLineId
  ),
  baseWithDiscountNoVariantIdNoTaxAmount: withoutTaxAmount(
    transactionReviewSelectors.baseWithDiscountNoVariantId
  ),
  fullNoTaxAmount: withoutTaxAmount(transactionReviewSelectors.full),
  fullNoQuizAwardId: withoutQuizAwardId(transactionReviewSelectors.full),
  fullNoQuizAwardIdNoTaxAmount: withoutTaxAmount(
    withoutQuizAwardId(transactionReviewSelectors.full)
  ),
  fullNoLineId: withoutLineId(transactionReviewSelectors.full),
  fullNoLineIdNoTaxAmount: withoutTaxAmount(
    withoutLineId(transactionReviewSelectors.full)
  ),
  fullNoLineIdNoVariantId: withoutVariantRelationship(
    withoutLineId(transactionReviewSelectors.full)
  ),
  fullNoLineIdNoVariantIdNoTaxAmount: withoutTaxAmount(
    withoutVariantRelationship(withoutLineId(transactionReviewSelectors.full))
  ),
  fullNoTransactionDate: withoutTransactionDate(
    transactionReviewSelectors.full
  ),
  fullNoTransactionDateNoTaxAmount: withoutTaxAmount(
    withoutTransactionDate(transactionReviewSelectors.full)
  ),
  fullNoCancelledAt: withoutCancelledAt(transactionReviewSelectors.full),
  fullNoCancelledAtNoTaxAmount: withoutTaxAmount(
    withoutCancelledAt(transactionReviewSelectors.full)
  ),
  fullNoAdTracking: withoutAdTracking(transactionReviewSelectors.full),
  fullNoAdTrackingNoTaxAmount: withoutTaxAmount(
    withoutAdTracking(transactionReviewSelectors.full)
  ),
  fullNoVariantId: withoutVariantRelationship(transactionReviewSelectors.full),
  fullNoVariantIdNoTaxAmount: withoutTaxAmount(
    withoutVariantRelationship(transactionReviewSelectors.full)
  ),
  fullNoVariantIdNoDiscountCode: withoutVariantRelationship(
    transactionReviewSelectors.fullNoDiscountCode
  ),
  fullNoVariantIdNoDiscountCodeNoTaxAmount: withoutTaxAmount(
    withoutVariantRelationship(transactionReviewSelectors.fullNoDiscountCode)
  ),
  fullNoDiscountCodeNoDiscount: withoutDiscountAmount(
    transactionReviewSelectors.fullNoDiscountCode
  ),
  fullNoDiscountCodeNoDiscountNoTaxAmount: withoutTaxAmount(
    withoutDiscountAmount(transactionReviewSelectors.fullNoDiscountCode)
  ),
  fullNoVariantIdNoDiscount: withoutVariantRelationship(
    transactionReviewSelectors.fullNoDiscount
  ),
  fullNoVariantIdNoDiscountNoTaxAmount: withoutTaxAmount(
    withoutVariantRelationship(transactionReviewSelectors.fullNoDiscount)
  ),
  fullNoVariantIdNoDiscountCodeNoDiscount: withoutVariantRelationship(
    withoutDiscountAmount(transactionReviewSelectors.fullNoDiscountCode)
  ),
  fullNoVariantIdNoDiscountCodeNoDiscountNoTaxAmount: withoutTaxAmount(
    withoutVariantRelationship(
      withoutDiscountAmount(transactionReviewSelectors.fullNoDiscountCode)
    )
  ),
  fullNoDiscountCodeNoTaxAmount: withoutTaxAmount(
    transactionReviewSelectors.fullNoDiscountCode
  ),
  fullNoDiscountNoTaxAmount: withoutTaxAmount(
    transactionReviewSelectors.fullNoDiscount
  ),
  legacyNoTaxAmount: withoutTaxAmount(transactionReviewSelectors.legacy),
  legacyNoVariantAttributesNoTaxAmount: withoutTaxAmount(
    transactionReviewSelectors.legacyNoVariantAttributes
  ),
  legacyNoVariantAttributesNoProductMatchStatus: withoutProductMatchStatus(
    transactionReviewSelectors.legacyNoVariantAttributes
  ),
  legacyNoVariantAttributesNoProductMatchStatusNoTaxAmount: withoutTaxAmount(
    withoutProductMatchStatus(
      transactionReviewSelectors.legacyNoVariantAttributes
    )
  ),
  legacyNoVariantAttributesNoDiscountCode: withoutDiscountCode(
    transactionReviewSelectors.legacyNoVariantAttributes
  ),
  legacyNoVariantAttributesNoDiscountCodeNoTaxAmount: withoutTaxAmount(
    withoutDiscountCode(transactionReviewSelectors.legacyNoVariantAttributes)
  ),
  legacyNoVariantAttributesNoProductMatchStatusNoDiscountCode:
    withoutDiscountCode(
      withoutProductMatchStatus(
        transactionReviewSelectors.legacyNoVariantAttributes
      )
    ),
  legacyNoVariantAttributesNoProductMatchStatusNoDiscountCodeNoTaxAmount:
    withoutTaxAmount(
      withoutDiscountCode(
        withoutProductMatchStatus(
          transactionReviewSelectors.legacyNoVariantAttributes
        )
      )
    ),
  legacyNoVariantAttributesNoLaterFieldsNoTaxAmount: withoutTaxAmount(
    transactionReviewSelectors.legacyNoVariantAttributesNoLaterFields
  ),
  legacyNoVariantAttributesNoProductMatchStatusNoLaterFields:
    withoutProductMatchStatus(
      transactionReviewSelectors.legacyNoVariantAttributesNoLaterFields
    ),
  legacyNoVariantAttributesNoProductMatchStatusNoLaterFieldsNoTaxAmount:
    withoutTaxAmount(
      withoutProductMatchStatus(
        transactionReviewSelectors.legacyNoVariantAttributesNoLaterFields
      )
    ),
  legacyNoProductMatchStatusNoTaxAmount: withoutTaxAmount(
    transactionReviewSelectors.legacyNoProductMatchStatus
  ),
  legacyNoAdjustmentsNoTaxAmount: withoutTaxAmount(
    transactionReviewSelectors.legacyNoAdjustments
  ),
  legacyNoDiscountCodeNoTaxAmount: withoutTaxAmount(
    transactionReviewSelectors.legacyNoDiscountCode
  ),
  legacyNoAdjustmentsNoDiscountCodeNoTaxAmount: withoutTaxAmount(
    transactionReviewSelectors.legacyNoAdjustmentsNoDiscountCode
  ),
  legacyCompatNoTaxAmount: withoutTaxAmount(
    transactionReviewSelectors.legacyCompat
  ),
  legacyNoCancelledAt: withoutCancelledAt(transactionReviewSelectors.legacy),
  legacyNoCancelledAtNoTaxAmount: withoutTaxAmount(
    withoutCancelledAt(transactionReviewSelectors.legacy)
  ),
} as const;
