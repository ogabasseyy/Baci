import { findVariantOptionGaps } from '@baci/shared';
import { formatAttributeLabel } from '@/lib/product-variant-attributes';
import {
  buildVariantAttributeRecord,
  type VariantAttributeFormValue,
} from '@/lib/product-variant-form';

const MAX_LISTED_VARIANTS = 3;

/**
 * Explains, in the merchant's words, which variant rows leave blank an
 * option the other rows fill in. Returns null when every row is
 * complete. Shoppers choose a variant by tapping options, so a row
 * with a blank can be hard to pick on the storefront.
 */
export function describeVariantOptionGaps(
  variants: ReadonlyArray<{ attributes: VariantAttributeFormValue[] }>
): string | null {
  const gaps = findVariantOptionGaps(
    variants.map((variant) => buildVariantAttributeRecord(variant.attributes))
  );
  if (gaps.length === 0) {
    return null;
  }

  const lines = gaps
    .slice(0, MAX_LISTED_VARIANTS)
    .map(
      (gap) =>
        `Variant ${gap.variantIndex + 1}: ${gap.missingAxes
          .map(formatAttributeLabel)
          .join(', ')}`
    );
  const remaining = gaps.length - lines.length;
  if (remaining > 0) {
    lines.push(`…and ${remaining} more`);
  }

  return [
    'Some variants are missing options that your other variants have:',
    '',
    ...lines,
    '',
    'Shoppers pick a variant by tapping these options, so a variant with a blank can be hard to choose. Fill them in, or remove the option from the other variants.',
  ].join('\n');
}
