import { formatCurrencyCompact } from '@/lib/currency';
import { formatVerifiedProductSpecHighlights } from '@/lib/format-verified-product-spec-highlights';
import { toTitleCase } from '@/lib/to-title-case';
import type { ProductSemanticCandidate } from './product-semantic-types';

export interface BuildProductCardDescriptionInput {
  candidate: ProductSemanticCandidate;
  categorySlug?: string | null;
  currentProduct?: ProductSemanticCandidate;
  countryCode?: string | null;
}

export function buildProductCardDescription(
  input: BuildProductCardDescriptionInput
): string {
  const segments: string[] = [];
  const condition = input.candidate.condition?.trim();
  if (condition) {
    segments.push(toTitleCase(condition));
  }

  const country = input.countryCode || 'NG';
  let priceSegment = formatCurrencyCompact(input.candidate.price, country);

  if (
    input.currentProduct &&
    input.currentProduct.price > 0 &&
    input.candidate.price > 0
  ) {
    if (input.candidate.price < input.currentProduct.price) {
      const savings = formatCurrencyCompact(
        input.currentProduct.price - input.candidate.price,
        country
      );
      priceSegment += ` (Save ${savings})`;
    } else if (input.candidate.price > input.currentProduct.price) {
      const delta = formatCurrencyCompact(
        input.candidate.price - input.currentProduct.price,
        country
      );
      priceSegment += ` (+${delta})`;
    }
  }

  segments.push(priceSegment);

  const highlights = formatVerifiedProductSpecHighlights({
    specs: input.candidate.product_key_specs,
    category: input.categorySlug ?? input.candidate.category_slug,
    maxHighlights: 2,
  });

  if (highlights.length > 0) {
    segments.push(highlights.join(', '));
  }

  return segments.join(' • ');
}
