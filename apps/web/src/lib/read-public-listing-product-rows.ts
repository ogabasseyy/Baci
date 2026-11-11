import type { AdvertisedPhoneProduct } from './advertised-phone-price-projection';

export type ListingRow = AdvertisedPhoneProduct & Record<string, unknown>;
const optionalString = (value: unknown) =>
  value == null || typeof value === 'string';
const optionalNumber = (value: unknown) =>
  value == null || (typeof value === 'number' && Number.isFinite(value));
const optionalNumericScalar = (value: unknown) =>
  optionalNumber(value) ||
  (typeof value === 'string' &&
    value.trim() !== '' &&
    Number.isFinite(Number(value)));
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isCategory(value: unknown): boolean {
  return (
    isRecord(value) && optionalString(value.name) && optionalString(value.slug)
  );
}
function isProductCategoryRelation(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.categories == null) return true;
  return Array.isArray(value.categories)
    ? value.categories.every(isCategory)
    : isCategory(value.categories);
}
function isListingRow(value: unknown): value is ListingRow {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id.trim())
    return false;
  if (
    ![
      'name',
      'category',
      'category_slug',
      'condition',
      'variant_model',
      'advertised_condition',
      'availability',
    ].every((key) => optionalString(value[key]))
  )
    return false;
  if (
    !['price', 'compare_at_price', 'stock', 'stock_quantity'].every((key) =>
      optionalNumericScalar(value[key])
    )
  )
    return false;
  if (
    ![
      'advertised_price',
      'advertised_compare_at_price',
      'advertised_min_variant_price',
      'advertised_max_variant_price',
    ].every((key) => optionalNumber(value[key]))
  )
    return false;
  if (
    !['manage_stock', 'has_variants'].every(
      (key) => value[key] == null || typeof value[key] === 'boolean'
    )
  )
    return false;
  if (
    value.advertised_image !== undefined &&
    typeof value.advertised_image !== 'string'
  )
    return false;
  if (
    [
      'advertised_price',
      'advertised_min_variant_price',
      'advertised_max_variant_price',
    ].some(
      (key) =>
        value[key] !== undefined &&
        (typeof value[key] !== 'number' || !Number.isFinite(value[key]))
    )
  )
    return false;
  if (
    value.product_categories != null &&
    (!Array.isArray(value.product_categories) ||
      !value.product_categories.every(isProductCategoryRelation))
  )
    return false;
  return (
    value.categories == null ||
    (Array.isArray(value.categories)
      ? value.categories.every(isCategory)
      : isCategory(value.categories))
  );
}

/** Validate the runtime select boundary without discarding unrelated safe columns. */
export function readPublicListingProductRows(value: unknown): ListingRow[] {
  if (!Array.isArray(value))
    throw new Error('Invalid public listing product projection');
  return value.map((row: unknown) => {
    if (!isListingRow(row))
      throw new Error('Invalid public listing product projection');
    return row;
  });
}
