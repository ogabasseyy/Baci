interface SupabaseQueryError {
  code?: string;
  details?: string;
  hint?: string;
  message?: string;
}

export function isTransactionReviewSchemaCacheError(
  error: SupabaseQueryError | null
) {
  const errorText = [error?.code, error?.message, error?.details, error?.hint]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  const isMissingSchemaShape =
    errorText.includes('schema cache') || error?.code === '42703';
  const mentionsTransactionReviewShape =
    errorText.includes('order_items') ||
    errorText.includes('order_item_unit_costs') ||
    errorText.includes('orders') ||
    errorText.includes('product_match_status') ||
    errorText.includes('supplier_name') ||
    errorText.includes('unit_index') ||
    errorText.includes('identifier_type') ||
    errorText.includes('identifier_value') ||
    errorText.includes('transaction_date') ||
    errorText.includes('cost_price') ||
    errorText.includes('discount_amount') ||
    errorText.includes('discount_code_id') ||
    errorText.includes('assurance_fee') ||
    errorText.includes('vat_category_code') ||
    errorText.includes('vat_rate') ||
    errorText.includes('product_variants') ||
    errorText.includes('variant_id') ||
    errorText.includes('variant_attributes');

  return isMissingSchemaShape && mentionsTransactionReviewShape;
}
