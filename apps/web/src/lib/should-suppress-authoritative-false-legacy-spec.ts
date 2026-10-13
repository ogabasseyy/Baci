import type { ProductCategorySource } from './product-schema-spec-classification';
import { AUTHORITATIVE_FALSE_CAPABILITY_SUPPRESSIONS } from './product-schema-spec-key-sets';

function isExplicitNegativeCapabilityValue(value: unknown) {
  return (
    value === false ||
    (typeof value === 'string' &&
      ['false', 'no'].includes(value.trim().toLowerCase()))
  );
}

export function shouldSuppressAuthoritativeFalseLegacySpec(
  product: ProductCategorySource,
  candidate: { key?: string; label?: string; value: unknown },
  canonicalSpecKey: string | undefined
) {
  if (!canonicalSpecKey || !product.product_key_specs) {
    return false;
  }

  for (const suppression of AUTHORITATIVE_FALSE_CAPABILITY_SUPPRESSIONS) {
    if (product.product_key_specs[suppression.authoritativeKey] !== false) {
      continue;
    }

    if (!suppression.suppressedKeys.includes(canonicalSpecKey)) {
      continue;
    }

    const isAuthoritativeFalseCandidate =
      candidate.key === suppression.authoritativeKey &&
      isExplicitNegativeCapabilityValue(candidate.value);
    if (!isAuthoritativeFalseCandidate) {
      return true;
    }
  }

  return false;
}
