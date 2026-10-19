/** Shared input validation for Jumia feed payloads. */

/** Trims and validates that a required string field is non-empty. */
export function validateRequiredString(
  value: string,
  fieldName: string,
  context: string
): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${context}: each ${fieldName} must be a non-empty string`);
  }
  return trimmed;
}

/** Validates that a numeric field is finite and positive (> 0). */
export function validatePositiveNumber(
  value: number,
  fieldName: string,
  context: string
): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${context}: ${fieldName} must be a positive number`);
  }
  return value;
}

/** Validates a product variation's numeric fields. */
export function validateVariation(
  variation: {
    globalPrice: { value: number; currency?: string };
    stock?: number;
  },
  index: number,
  context: string
): void {
  if (
    !Number.isFinite(variation.globalPrice.value) ||
    variation.globalPrice.value < 0
  ) {
    throw new Error(
      `${context}: variation[${index}].globalPrice.value must be >= 0`
    );
  }
  if (
    'currency' in variation.globalPrice &&
    !variation.globalPrice.currency?.trim()
  ) {
    throw new Error(
      `${context}: variation[${index}].globalPrice.currency must be a non-empty string`
    );
  }
  if (
    variation.stock != null &&
    (!Number.isFinite(variation.stock) ||
      !Number.isInteger(variation.stock) ||
      variation.stock < 0)
  ) {
    throw new Error(`${context}: variation[${index}].stock must be >= 0`);
  }
}
