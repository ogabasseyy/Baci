import {
  canonicalizeCommerceVariantAxis,
  normalizeCommerceVariantOption,
} from '@baci/shared/lib/commerce-variant-axis';
import { isRecord } from './product-card-is-record';

const MAX_OPTION_KEY_LENGTH = 40;
const MAX_OPTION_VALUE_LENGTH = 80;

/**
 * Projects variant attributes onto the storefront's canonical purchase axes
 * (processor, graphics, merchant-defined SKU dimensions, …) so variants that
 * differ only by those axes stay distinguishable. Display-only metadata axes
 * are dropped; two keys that canonicalize to the same axis are ambiguous.
 */
export function projectAttributes(
  value: unknown
): Record<string, string> | null {
  if (value == null) return {};
  if (!isRecord(value)) return null;
  const output: Record<string, string> = {};
  for (const [key, rawValue] of Object.entries(value)) {
    if (key.length > MAX_OPTION_KEY_LENGTH) return null;
    const axis = canonicalizeCommerceVariantAxis(key);
    if (!axis || axis === 'condition') continue;
    if (Object.hasOwn(output, axis)) return null;
    if (
      typeof rawValue !== 'string' ||
      rawValue.length > MAX_OPTION_VALUE_LENGTH
    ) {
      return null;
    }
    const cleanValue = normalizeCommerceVariantOption(axis, rawValue);
    if (cleanValue && cleanValue.length <= MAX_OPTION_VALUE_LENGTH) {
      output[axis] = cleanValue;
    }
  }
  return output;
}
